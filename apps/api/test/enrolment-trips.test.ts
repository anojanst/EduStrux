import { createDb, guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { countTrips } from '../src/middleware/db';
import * as enrolment from '../src/modules/enrolment/service';
import { call, db, newOrg, newUser } from './helpers';

// The budget is about 3 database trips in sequence: sign-in, one read stage, one write (D-102).
// `stages` is the trips a request waited for one after another, and `trips` every call it made.
// Each case is one request on the heaviest path of its endpoint.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
/** The Monday after today, so the term is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * Two branches, each with a class that has a term and a limit on its places. The teacher teaches
 * the Main class, the parent is a guardian of the Main family, and the staff member is limited
 * to Albany. Mia, of the Main family, is in both classes and Ari, of the Albany family, in
 * Albany's. Sam and Kiri are in no class yet.
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
  // Each with a grade, so reading the student reads everything it can.
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

  return { org, api, teacher, parent, staff, mainGroup, albanyGroup, mia, sam, ari, kiri, start };
}

let c: Awaited<ReturnType<typeof centre>>;
beforeAll(async () => {
  c = await centre();
});

describe('GET /enrolments', () => {
  // Each caller, with a student and a class they reach that share an enrolment, and what they
  // see with no filter.
  const callers = (): [string, As, Row, Row, string[]][] => [
    ['the owner', c.api, c.mia, c.albanyGroup, ['Main group', 'Albany group', 'Albany group']],
    ['a teacher', c.teacher.as, c.mia, c.mainGroup, ['Main group']],
    ['a parent', c.parent.as, c.mia, c.albanyGroup, ['Main group', 'Albany group']],
    ['staff of one branch', c.staff.as, c.ari, c.albanyGroup, ['Albany group', 'Albany group']],
  ];
  const classNames = (res: Awaited<ReturnType<typeof call>>) =>
    res.body.data.map((e: { className: string }) => e.className) as string[];

  it('reads a page with its names in one stage, whoever asks', async () => {
    for (const [who, as, , , sees] of callers()) {
      const res = await as('GET', '/enrolments');
      expect(res.status, who).toBe(200);
      expect(classNames(res), who).toEqual(sees);
      console.log(`GET /enrolments, ${who}:`, res.db);
    }
  });

  it('checks the student or the class asked for in the same stage as the page', async () => {
    for (const [who, as, student, klass] of callers()) {
      const ofStudent = await as('GET', `/enrolments?studentId=${student.id}`);
      const inClass = await as('GET', `/enrolments?classId=${klass.id}`);
      const both = await as('GET', `/enrolments?studentId=${student.id}&classId=${klass.id}`);

      for (const res of [ofStudent, inClass, both]) {
        expect(res.status, who).toBe(200);
        expect(res.body.data.length, who).toBeGreaterThan(0);
      }
      expect(classNames(both), who).toEqual([klass === c.mainGroup ? 'Main group' : 'Albany group']);
      console.log(`GET /enrolments?studentId, ${who}:`, ofStudent.db);
      console.log(`GET /enrolments?classId, ${who}:`, inClass.db);
      console.log(`GET /enrolments?studentId&classId, ${who}:`, both.db);
    }
  });
});

describe('POST /enrolments', () => {
  it('enrols into a class with a term and a limit', async () => {
    const byOwner = await c.api('POST', '/enrolments', {
      studentId: c.sam.id,
      classId: c.mainGroup.id,
    });
    const byStaff = await c.staff.as('POST', '/enrolments', {
      studentId: c.kiri.id,
      classId: c.albanyGroup.id,
    });

    expect([byOwner.status, byStaff.status]).toEqual([201, 201]);
    expect(byOwner.body).toMatchObject({ studentFirstName: 'Sam', className: 'Main group' });
    expect(byOwner.body.startDate).toBe(c.start);
    console.log('POST /enrolments, the owner:', byOwner.db);
    console.log('POST /enrolments, staff of one branch:', byStaff.db);
  });
});

describe('what other modules read of enrolments', () => {
  it('costs one statement each', async () => {
    const { d1, counts } = countTrips(env.DB);
    const ctx = { db: createDb(d1), orgId: c.org.id, actorUserId: null };
    const reads: [string, () => Promise<unknown>][] = [
      ['countEnrolments', () => enrolment.countEnrolments(ctx, { classId: c.albanyGroup.id })],
      ['studentIdsExpected', () => enrolment.studentIdsExpected(ctx, c.albanyGroup.id, c.start)],
      ['spansOf', () => enrolment.spansOf(ctx, c.mia.id)],
      [
        'enrolmentsToInvoice',
        () =>
          enrolment.enrolmentsToInvoice(ctx, [c.albanyGroup.id], {
            startDate: c.start,
            endDate: addDays(c.start, 69),
          }),
      ],
    ];

    for (const [name, read] of reads) {
      const before = { ...counts };
      await read();
      expect(counts.trips - before.trips, name).toBe(1);
    }
    expect(counts).toMatchObject({ trips: 4, stages: 4 });
  });
});
