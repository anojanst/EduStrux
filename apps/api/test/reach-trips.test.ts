import { createDb, enrolments, guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { firstIds, idsFrom, wide } from '../src/db/scope';
import { countTrips } from '../src/middleware/db';
import * as enrolmentRepo from '../src/modules/enrolment/repository';
import * as people from '../src/modules/people/service';
import { call, db, newOrg, newUser } from './helpers';

// What a caller may see is worked out inside the statement that reads it, as a subquery, so a
// teacher, a parent and staff limited to a branch make the same D1 calls as the owner (D-104).
// Before, each of them first read the ids of what they reach, in one or two calls of their own.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * Two branches. Main has a class the teacher teaches and a family the parent is a guardian of,
 * whose child Mia is in both branches' first classes. Albany has two classes and Ari's family;
 * the staff member is limited to it. Each family has one issued invoice.
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
    defaultPrice: { amount: 45000, currency: 'NZD' },
  });
  const start = nextMonday();
  const end = addDays(start, 69);
  const year = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: end,
  });

  const teacher = await member('teacher');
  const parent = await member('parent');
  const staff = await member('branch_manager', [albany.id]);

  /** A class with a lesson every Tuesday of the term, and the first of those lessons. */
  const addClass = async (name: string, body: Record<string, unknown>) => {
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name,
      ...body,
    });
    const scheduled = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 2, startTime: '16:00', endTime: '17:00' }],
    });
    if (scheduled.status !== 200) throw new Error(`schedule failed for ${name}`);
    const lessons = await api('GET', `/sessions?classId=${klass.id}&from=${start}&to=${end}`);
    return { klass, session: lessons.body.data[0] as Row };
  };
  const mainGroup = await addClass('Main group', { teacherId: teacher.id });
  const albanyGroup = await addClass('Albany group', { branchId: albany.id });
  const otherGroup = await addClass('Other group', { branchId: albany.id });

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
  const mia = await make('/students', {
    familyId: mainFamily.id,
    firstName: 'Mia',
    lastName: 'Perera',
  });
  const albanyFamily = await make('/families', { name: 'Albany family', branchId: albany.id });
  const ari = await make('/students', {
    familyId: albanyFamily.id,
    firstName: 'Ari',
    lastName: 'Silva',
  });
  await make('/enrolments', { studentId: mia.id, classId: mainGroup.klass.id });
  await make('/enrolments', { studentId: mia.id, classId: albanyGroup.klass.id });
  await make('/enrolments', { studentId: ari.id, classId: albanyGroup.klass.id });
  await make('/enrolments', { studentId: ari.id, classId: otherGroup.klass.id });

  // One invoice per family, issued so the parent can see theirs.
  const run = await api('POST', `/terms/${term.id}/generate-invoices`, {});
  for (let tries = 0; ; tries++) {
    const job = (await api('GET', `/jobs/${run.body.jobId}`)).body;
    if (job.status === 'succeeded') break;
    if (job.status === 'failed' || tries > 400) throw new Error(`invoice run: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const invoices = (await api('GET', '/invoices')).body.data as (Row & { familyId: string })[];
  for (const invoice of invoices) await api('POST', `/invoices/${invoice.id}/issue`);
  const invoiceOf = (family: Row) => invoices.find((invoice) => invoice.familyId === family.id)!;

  return {
    org,
    api,
    teacher,
    parent,
    staff,
    range: `from=${start}&to=${end}`,
    // The records of each branch, as the paths that read them one at a time.
    inMain: {
      family: `/families/${mainFamily.id}`,
      student: `/students/${mia.id}`,
      klass: `/classes/${mainGroup.klass.id}`,
      session: `/sessions/${mainGroup.session.id}`,
      invoice: `/invoices/${invoiceOf(mainFamily).id}`,
    },
    inAlbany: {
      family: `/families/${albanyFamily.id}`,
      student: `/students/${ari.id}`,
      klass: `/classes/${albanyGroup.klass.id}`,
      session: `/sessions/${albanyGroup.session.id}`,
      invoice: `/invoices/${invoiceOf(albanyFamily).id}`,
    },
    // A class none of the parent's children is in.
    other: {
      klass: `/classes/${otherGroup.klass.id}`,
      session: `/sessions/${otherGroup.session.id}`,
    },
    ari,
  };
}

describe('working out what a caller may see costs no database trip (D-104)', () => {
  it('a teacher, a parent and staff limited to a branch make the same trips as the owner', async () => {
    const c = await centre();
    const { inMain, inAlbany } = c;
    // The request, as the owner, the teacher and the parent ask it, and as the Albany staff do.
    const gets: [string, string, string][] = [
      ['GET /families', '/families', '/families'],
      ['GET /families/{id}', inMain.family, inAlbany.family],
      ['GET /students', '/students', '/students'],
      ['GET /students/{id}', inMain.student, inAlbany.student],
      ['GET /enrolments', '/enrolments', '/enrolments'],
      ['GET /classes', '/classes', '/classes'],
      ['GET /classes/{id}', inMain.klass, inAlbany.klass],
      ['GET /sessions', `/sessions?${c.range}`, `/sessions?${c.range}`],
      ['GET /sessions/{id}', inMain.session, inAlbany.session],
    ];

    for (const [request, path, staffPath] of gets) {
      const owner = await c.api('GET', path);
      const scoped = [
        await c.teacher.as('GET', path),
        await c.parent.as('GET', path),
        await c.staff.as('GET', staffPath),
      ];
      // Every caller gets rows, so every caller also pays for what a page shows of other tables.
      for (const res of [owner, ...scoped]) {
        expect(res.status, request).toBe(200);
        if ('data' in res.body) expect(res.body.data.length, request).toBeGreaterThan(0);
      }
      expect(
        scoped.map((res) => res.db),
        request,
      ).toEqual([owner.db, owner.db, owner.db]);
    }
  });

  it('holds for invoices, which a teacher has no access to at all', async () => {
    const c = await centre();
    const gets: [string, string, string][] = [
      ['GET /invoices', '/invoices', '/invoices'],
      ['GET /invoices/{id}', c.inMain.invoice, c.inAlbany.invoice],
    ];

    for (const [request, path, staffPath] of gets) {
      const owner = await c.api('GET', path);
      const parent = await c.parent.as('GET', path);
      const staff = await c.staff.as('GET', staffPath);
      expect([owner.status, parent.status, staff.status], request).toEqual([200, 200, 200]);
      expect([parent.db, staff.db], request).toEqual([owner.db, owner.db]);

      // Refused by the permission, after the sign-in trip and before anything else is read.
      const teacher = await c.teacher.as('GET', path);
      expect(teacher.status, request).toBe(403);
      expect(teacher.db, request).toEqual({ trips: 1, stages: 1 });
    }
  });
});

describe('each role still sees their own records and not the neighbour’s', () => {
  const statuses = async (as: As, paths: string[]) => {
    const answers: number[] = [];
    for (const path of paths) answers.push((await as('GET', path)).status);
    return answers;
  };

  it('one record at a time, in every module', async () => {
    const { teacher, parent, staff, inMain, inAlbany, other } = await centre();
    const { invoice: mainInvoice, ...mainRecords } = inMain;
    const { invoice: albanyInvoice, ...albanyRecords } = inAlbany;

    // The teacher teaches the Main class, and Mia is in it.
    expect(await statuses(teacher.as, Object.values(mainRecords))).toEqual([200, 200, 200, 200]);
    expect(await statuses(teacher.as, Object.values(albanyRecords))).toEqual([404, 404, 404, 404]);
    expect(await statuses(teacher.as, [other.klass, other.session])).toEqual([404, 404]);

    // The parent's child Mia is in the Main class and in Albany's first one, so they see those
    // two classes, but nothing of Ari's family and nothing of the class Mia isn't in.
    expect(await statuses(parent.as, [...Object.values(mainRecords), mainInvoice])).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(await statuses(parent.as, [inAlbany.klass, inAlbany.session])).toEqual([200, 200]);
    expect(await statuses(parent.as, [inAlbany.family, inAlbany.student, albanyInvoice])).toEqual([
      404, 404, 404,
    ]);
    expect(await statuses(parent.as, [other.klass, other.session])).toEqual([404, 404]);

    // The staff member works in Albany only.
    expect(await statuses(staff.as, [...Object.values(albanyRecords), albanyInvoice])).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(await statuses(staff.as, [other.klass, other.session])).toEqual([200, 200]);
    expect(await statuses(staff.as, [...Object.values(mainRecords), mainInvoice])).toEqual([
      404, 404, 404, 404, 404,
    ]);
  });
});

describe('a query for ids, as the reads built on it will use one', () => {
  it('loads the names of the students on a page of enrolments in one statement', async () => {
    const c = await centre();
    const { d1, counts } = countTrips(env.DB);
    const ctx = { db: createDb(d1), orgId: c.org.id, actorUserId: null };
    // The students on the first `size` enrolments, oldest first: Mia, Mia, Ari, Ari.
    const onPage = (size: number) =>
      firstIds(idsFrom(ctx, enrolments, enrolments.studentId), size, asc(enrolments.id));
    const firstNames = async (size: number) =>
      [...(await people.studentNames(ctx, onPage(size))).values()].map((name) => name.firstName);

    expect(await firstNames(2)).toEqual(['Mia']);
    expect((await firstNames(3)).sort()).toEqual(['Ari', 'Mia']);
    expect(counts.trips).toBe(2); // one statement each: the page is read inside it
  });

  it('reads a wide query on the table it filters once, and never matches a row against itself', async () => {
    const c = await centre();
    const ctx = { db: db(), orgId: c.org.id, actorUserId: null };
    // The enrolments in Ari's classes, with those classes marked wide. Both are enrolments, so
    // looking each row up in the query by name would compare every row with itself.
    const inArisClasses = { classIds: wide(enrolmentRepo.activeClasses(ctx, [c.ari.id])) };

    const rows = await enrolmentRepo.listEnrolments(ctx, 50, undefined, {}, inArisClasses);

    const all = (await c.api('GET', '/enrolments')).body.data as { className: string }[];
    expect(all.map((e) => e.className)).toEqual([
      'Main group',
      'Albany group',
      'Albany group',
      'Other group',
    ]);
    expect(rows).toHaveLength(3); // every one but Mia's place in the Main class
  });
});
