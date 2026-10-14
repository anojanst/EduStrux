import { createDb, enrolments, guardians, memberships, orgs } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Access, OrgCtx } from '../src/db/scope';
import { countTrips } from '../src/middleware/db';
import * as classes from '../src/modules/classes/service';
import * as enrolment from '../src/modules/enrolment/service';
import * as people from '../src/modules/people/service';
import { call, db, newOrg, newUser } from './helpers';

// The budget is about 3 database trips in sequence: sign-in, one read stage, one write (D-102).
// `stages` is the trips a request waited for one after another, and `trips` every call it made.
// Each case is one request on the heaviest path of its endpoint.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
/** The Monday after today, so the term is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string };
type Listed = Row & { studentId: string; classId: string; studentFirstName: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
const asOwner: Access = { scope: 'all', role: 'owner', membershipId: 'mem_owner', branchIds: null };

/**
 * Two branches, each with a class that has a term and a limit on its places. The teacher teaches
 * the Main class, the parent is a guardian of the Main family, and the staff member is limited
 * to Albany. Mia, of the Main family, is in both classes and Ari, of the Albany family, in
 * Albany's. Sam and Kiri are in no class yet, and nobody is in the Spare class.
 */
async function centre() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    durationMinutes: 60,
  });
  const start = nextMonday();
  const year = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: addDays(start, 69),
  });

  const teacher = await member('teacher');
  const parent = await member('parent');
  const staff = await member('branch_manager', [albany.id]);

  const addClass = (name: string, body: Record<string, unknown>) =>
    make('/classes', { courseId: course.id, termId: term.id, name, capacity: 10, ...body });
  const mainGroup = await addClass('Main group', { branchId: main.id, teacherId: teacher.id });
  const albanyGroup = await addClass('Albany group', { branchId: albany.id });
  const spare = await addClass('Spare', { branchId: main.id });

  const mainFamily = await make('/families', { name: 'Main family', branchId: main.id });
  const guardian = await make(`/families/${mainFamily.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db()
    .update(guardians)
    .set({ membershipId: parent.id })
    .where(eq(guardians.id, guardian.id));
  const albanyFamily = await make('/families', { name: 'Albany family', branchId: albany.id });
  // Each with a grade, so reading a student reads everything it can.
  const addStudent = (family: Row, firstName: string) =>
    make('/students', {
      familyId: family.id,
      firstName,
      lastName: 'Perera',
      gradeLevelId: grade.id,
    });
  const mia = await addStudent(mainFamily, 'Mia');
  const sam = await addStudent(mainFamily, 'Sam');
  const ari = await addStudent(albanyFamily, 'Ari');
  const kiri = await addStudent(albanyFamily, 'Kiri');
  await make('/enrolments', { studentId: mia.id, classId: mainGroup.id });
  await make('/enrolments', { studentId: mia.id, classId: albanyGroup.id });
  await make('/enrolments', { studentId: ari.id, classId: albanyGroup.id });

  const row = (await db().query.orgs.findFirst({ where: eq(orgs.id, org.id) }))!;
  return {
    org: row,
    api,
    teacher,
    parent,
    staff,
    mainGroup,
    albanyGroup,
    spare,
    mia,
    sam,
    ari,
    kiri,
    start,
    end: addDays(start, 69),
  };
}

/** One centre for the whole file. The cases that enrol someone come last. */
let c: Awaited<ReturnType<typeof centre>>;
/**
 * How many stages `people.getStudent` and `classes.getClass` each wait for. Both endpoints send
 * them in their read stage, so that stage is as deep as the deeper of the two: 2 each here.
 * TUI-95 makes the first one stage and TUI-96 the second, and these numbers follow.
 */
let deep: { student: number; klass: number };

/** A context that counts its D1 calls, with the org in hand as it is in a request. */
function counted(d1: D1Database = env.DB) {
  const { d1: counting, counts } = countTrips(d1);
  const ctx: OrgCtx = { db: createDb(counting), orgId: c.org.id, actorUserId: null, org: c.org };
  return { ctx, counts };
}

beforeAll(async () => {
  c = await centre();
  const student = counted();
  await people.getStudent(student.ctx, asOwner, c.mia.id);
  const klass = counted();
  await classes.getClass(klass.ctx, asOwner, c.albanyGroup.id);
  deep = { student: student.counts.stages, klass: klass.counts.stages };
});

describe('GET /enrolments', () => {
  // Each caller, with a student and a class they reach that share an enrolment.
  const callers = {
    'the owner': () => ({ as: c.api, student: c.mia, klass: c.albanyGroup, sees: 3 }),
    'a teacher': () => ({ as: c.teacher.as, student: c.mia, klass: c.mainGroup, sees: 1 }),
    'a parent': () => ({ as: c.parent.as, student: c.mia, klass: c.albanyGroup, sees: 2 }),
    'staff of one branch': () => ({
      as: c.staff.as,
      student: c.ari,
      klass: c.albanyGroup,
      sees: 2,
    }),
  };

  it.each(Object.keys(callers) as (keyof typeof callers)[])(
    'reads the page, its names and the checks on its filters in one stage, for %s',
    async (who) => {
      const { as, student, klass, sees } = callers[who]();

      const all = await as('GET', '/enrolments');
      const ofStudent = await as('GET', `/enrolments?studentId=${student.id}`);
      const inClass = await as('GET', `/enrolments?classId=${klass.id}`);
      const both = await as('GET', `/enrolments?studentId=${student.id}&classId=${klass.id}`);

      // Each filtered page is the same rows as the whole list shows, names and all.
      const listed = all.body.data as Listed[];
      expect(listed).toHaveLength(sees);
      const hers = listed.filter((e) => e.studentId === student.id);
      const theirs = listed.filter((e) => e.classId === klass.id);
      expect(ofStudent.body.data).toEqual(hers);
      expect(inClass.body.data).toEqual(theirs);
      expect(both.body.data).toEqual(hers.filter((e) => e.classId === klass.id));
      expect(both.body.data).toHaveLength(1);

      // Sign-in, then one read stage.
      expect(all.db.stages).toBeLessThanOrEqual(2);
      expect(all.db.trips).toBeLessThanOrEqual(4);
      // The read stage is as deep as the check it sends, and no deeper. That is 3 stages in all
      // until `people.getStudent` (TUI-95) and `classes.getClass` (TUI-96) are one stage each.
      expect(ofStudent.db.stages).toBe(1 + deep.student);
      expect(inClass.db.stages).toBe(1 + deep.klass);
      expect(both.db.stages).toBe(1 + Math.max(deep.student, deep.klass));
      for (const res of [ofStudent, inClass, both]) expect(res.db.stages).toBeLessThanOrEqual(3);
      expect(ofStudent.db.trips).toBeLessThanOrEqual(6);
      expect(inClass.db.trips).toBeLessThanOrEqual(5);
      expect(both.db.trips).toBeLessThanOrEqual(7);
    },
  );

  it('answers 404 for a student or a class out of reach at the cost of one that doesn’t exist', async () => {
    const { as } = c.staff; // limited to Albany: Mia and the Main class are out of reach
    const outOfReach = [
      await as('GET', `/enrolments?studentId=${c.mia.id}`),
      await as('GET', `/enrolments?classId=${c.mainGroup.id}`),
    ];
    const missing = [
      await as('GET', '/enrolments?studentId=stu_nope'),
      await as('GET', '/enrolments?classId=cls_nope'),
    ];

    expect([...outOfReach, ...missing].map((res) => res.status)).toEqual([404, 404, 404, 404]);
    expect(outOfReach.map((res) => res.body)).toEqual(missing.map((res) => res.body));
    expect(outOfReach.map((res) => res.db)).toEqual(missing.map((res) => res.db));
  });

  it('still names an enrolment made while the page was being read', async () => {
    // The names are read by a query for the page, in the same stage as the page. Here the page
    // is held back until they are in, and Sam joins the Spare class in between: an enrolment on
    // the page whose student and class the names missed.
    const late = {
      id: newId('enrolment'),
      orgId: c.org.id,
      studentId: c.sam.id,
      classId: c.spare.id,
      startDate: c.start,
    };
    const others: Promise<unknown>[] = [];
    const readsThePage = (sql: string) => /^select [^(]+ from "enrolments"/.test(sql);
    const pageLast = {
      prepare(sql: string) {
        const statement = env.DB.prepare(sql);
        return {
          bind(...params: unknown[]) {
            const bound = statement.bind(...params);
            const heldBack = async () => {
              await new Promise((sent) => setTimeout(sent, 0)); // the others have gone out
              await Promise.all(others);
              await db().insert(enrolments).values(late);
              return bound.raw();
            };
            return {
              raw() {
                if (readsThePage(sql)) return heldBack();
                const sent = bound.raw();
                others.push(sent);
                return sent;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const { ctx, counts } = counted(pageLast);

    const page = await enrolment.listEnrolments(ctx, asOwner, 50, undefined, {});
    await db().delete(enrolments).where(eq(enrolments.id, late.id)); // the centre is shared

    expect(page.data.map((e) => `${e.studentFirstName} in ${e.className}`)).toEqual([
      'Mia in Main group',
      'Mia in Albany group',
      'Ari in Albany group',
      'Sam in Spare',
    ]);
    // The page with its names and labels, then the two that were missed: a stage paid only now.
    expect(counts).toMatchObject({ trips: 5, stages: 2 });
  });
});

describe('POST /enrolments', () => {
  it('reads everything in one stage, then writes, into a class with a term and a limit', async () => {
    const byOwner = await c.api('POST', '/enrolments', {
      studentId: c.sam.id,
      classId: c.mainGroup.id,
    });
    const byStaff = await c.staff.as('POST', '/enrolments', {
      studentId: c.kiri.id,
      classId: c.albanyGroup.id,
    });

    expect([byOwner.status, byStaff.status]).toEqual([201, 201]);
    expect(byOwner.body).toMatchObject({
      studentFirstName: 'Sam',
      className: 'Main group',
      startDate: c.start,
    });
    // What it answered with is what is stored: the row came back from the insert itself.
    const stored = (await c.api('GET', `/enrolments?studentId=${c.sam.id}`)).body.data;
    expect(stored).toEqual([byOwner.body]);

    for (const res of [byOwner, byStaff]) {
      // Sign-in, one read stage, one write. The read stage is as deep as the deeper of the
      // student and the class, and no deeper: 4 stages in all until TUI-95 and TUI-96 are in.
      expect(res.db.stages).toBe(1 + Math.max(deep.student, deep.klass) + 1);
      expect(res.db.stages).toBeLessThanOrEqual(4);
      expect(res.db.trips).toBeLessThanOrEqual(9);
    }
  });

  it('answers 404 for a student out of reach at the cost of one that doesn’t exist', async () => {
    const { as } = c.staff; // limited to Albany: Sam is out of reach
    const post = (studentId: string) =>
      as('POST', '/enrolments', { studentId, classId: c.albanyGroup.id });
    const outOfReach = await post(c.sam.id);
    const missing = await post('stu_nope');

    expect([outOfReach.status, missing.status]).toEqual([404, 404]);
    expect(outOfReach.body).toEqual(missing.body);
    expect(outOfReach.db).toEqual(missing.db);
  });
});

describe('what other modules read of enrolments', () => {
  it('costs one statement each', async () => {
    const { ctx, counts } = counted();
    const term = { startDate: c.start, endDate: c.end };
    const reads: [string, () => Promise<unknown>][] = [
      ['countEnrolments', () => enrolment.countEnrolments(ctx, { classId: c.albanyGroup.id })],
      ['studentIdsExpected', () => enrolment.studentIdsExpected(ctx, c.albanyGroup.id, c.start)],
      ['spansOf', () => enrolment.spansOf(ctx, c.mia.id)],
      ['enrolmentsToInvoice', () => enrolment.enrolmentsToInvoice(ctx, [c.albanyGroup.id], term)],
    ];

    for (const [name, read] of reads) {
      const before = counts.trips;
      await read();
      expect(counts.trips - before, name).toBe(1);
    }
  });
});
