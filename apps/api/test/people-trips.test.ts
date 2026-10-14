import { createDb, guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Access, OrgCtx } from '../src/db/scope';
import { countTrips } from '../src/middleware/db';
import * as people from '../src/modules/people/service';
import { call, db, newOrg, newUser } from './helpers';

// Every families and students endpoint, on its heaviest path, held to the budget of D-102: a
// read waits for D1 twice in a row (sign-in, one read stage) and a write three times (sign-in,
// one read stage, one write). `stages` is that number. `trips` is every call the request made,
// pinned at what was measured, so a new one shows up here. The comments give the numbers before.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone

type Row = { id: string; updatedAt: string };
type Res = Awaited<ReturnType<typeof call>>;
type As = (method: string, path: string, body?: unknown) => Promise<Res>;

/**
 * A centre of two branches with two grade levels and a current academic year. The Perera family
 * is in Main, with two guardians and two children. Mia is in Year 10 and in a class the teacher
 * teaches. Her brother Sam is in Year 11 and in no class. The parent signs in as Mere, the
 * first guardian. The Silva family, in Albany, is nobody's but the owner's.
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
  const member = async (role: Role) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db().insert(memberships).values({ id, orgId: org.id, userId: user.userId, role });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const year10 = await make('/grade-levels', { name: 'Year 10' });
  const year11 = await make('/grade-levels', { name: 'Year 11' });
  const year = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -100),
    endDate: addDays(today(), 100),
  });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: year10.id,
    durationMinutes: 60,
  });
  const teacher = await member('teacher');
  const parent = await member('parent');
  const klass = await make('/classes', {
    courseId: course.id,
    branchId: main.id,
    name: 'Group A',
    startDate: addDays(today(), -30),
    teacherId: teacher.id,
  });

  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  const tane = await make(`/families/${family.id}/guardians`, {
    firstName: 'Tane',
    lastName: 'Perera',
  });
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));
  const child = { familyId: family.id, lastName: 'Perera', dateOfBirth: '2012-05-17' };
  const mia = await make('/students', { ...child, firstName: 'Mia', gradeLevelId: year10.id });
  const sam = await make('/students', { ...child, firstName: 'Sam', gradeLevelId: year11.id });
  await make('/enrolments', {
    studentId: mia.id,
    classId: klass.id,
    startDate: addDays(today(), -30),
  });
  const silva = await make('/families', { name: 'Silva', branchId: albany.id });
  const ari = await make('/students', { familyId: silva.id, firstName: 'Ari', lastName: 'Silva' });

  return {
    org,
    api,
    make,
    teacher,
    parent,
    main,
    albany,
    year,
    year10,
    year11,
    family,
    tane,
    mia,
    sam,
    silva,
    ari,
  };
}

describe('families and students within the budget (D-102)', () => {
  it('a read waits for D1 twice in a row, for the owner, a teacher and a parent', async () => {
    const c = await centre();
    const { main, family, mia, year10 } = c;
    // The request, its heaviest path, and the trips it makes.
    const reads: [string, string, number][] = [
      ['GET /families', `/families?branchId=${main.id}`, 7], // 7 trips, 5 stages
      ['GET /families/{id}', `/families/${family.id}`, 6], // 6 trips, 4 stages
      [
        'GET /students',
        `/students?familyId=${family.id}&branchId=${main.id}&gradeLevelId=${year10.id}`,
        7, // 8 trips, 7 stages
      ],
      ['GET /students/{id}', `/students/${mia.id}`, 4], // 4 trips, 3 stages
    ];
    const roles: [string, As][] = [
      ['the owner', c.api],
      ['a teacher', c.teacher.as],
      ['a parent', c.parent.as],
    ];

    for (const [request, path, trips] of reads) {
      for (const [role, as] of roles) {
        const res = await as('GET', path);
        expect(res.status, `${request} as ${role}`).toBe(200);
        if ('data' in res.body) expect(res.body.data, `${request} as ${role}`).toHaveLength(1);
        expect(res.db.stages, `${request} as ${role}`).toBeLessThanOrEqual(2);
        expect(res.db.trips, `${request} as ${role}`).toBeLessThanOrEqual(trips);
      }
    }
  });

  it('a list shows each family and student as reading them one at a time does', async () => {
    const c = await centre();
    const names = (students: { firstName: string }[]) => students.map((s) => s.firstName);

    for (const as of [c.api, c.teacher.as, c.parent.as]) {
      const family = (await as('GET', `/families/${c.family.id}`)).body;
      const families = (await as('GET', `/families?branchId=${c.main.id}`)).body.data;
      expect(families).toEqual([family]);
      expect(family.guardians).toHaveLength(2);

      const mia = (await as('GET', `/students/${c.mia.id}`)).body;
      expect(mia).toMatchObject({ gradeLevelId: c.year10.id, branchId: c.main.id });
      expect(mia.grades).toEqual([{ academicYearId: c.year.id, gradeLevelId: c.year10.id }]);
      const inYear10 = (await as('GET', `/students?gradeLevelId=${c.year10.id}`)).body.data;
      expect(inYear10).toEqual([mia]);
      expect(family.students[0]).toEqual(mia);
    }

    // The teacher is shown Mia alone. The parent and the owner are shown her brother too.
    const seenBy = async (as: As) => ({
      inFamily: names((await as('GET', `/families/${c.family.id}`)).body.students),
      listed: names((await as('GET', '/students')).body.data),
    });
    expect(await seenBy(c.teacher.as)).toEqual({ inFamily: ['Mia'], listed: ['Mia'] });
    expect(await seenBy(c.parent.as)).toEqual({ inFamily: ['Mia', 'Sam'], listed: ['Mia', 'Sam'] });
    expect(await seenBy(c.api)).toEqual({
      inFamily: ['Mia', 'Sam'],
      listed: ['Mia', 'Sam', 'Ari'],
    });
  });

  it('a record outside a caller’s reach costs what one that doesn’t exist costs', async () => {
    const c = await centre();
    // The teacher doesn't teach Sam or Ari, and the Silva family is nobody's but the owner's.
    const outside: [As, string, string][] = [
      [c.teacher.as, `/families/${c.silva.id}`, '/families/fam_nope'],
      [c.teacher.as, `/students/${c.sam.id}`, '/students/stu_nope'],
      [c.parent.as, `/families/${c.silva.id}`, '/families/fam_nope'],
      [c.parent.as, `/students/${c.ari.id}`, '/students/stu_nope'],
    ];
    for (const [as, hidden, missing] of outside) {
      const [a, b] = [await as('GET', hidden), await as('GET', missing)];
      expect([a.status, b.status], hidden).toEqual([404, 404]);
      expect(a.body, hidden).toEqual(b.body);
      expect(a.db, hidden).toEqual(b.db);
    }
  });

  it('a write waits for D1 three times in a row, and answers with what is stored', async () => {
    const c = await centre();
    const { api, make, albany, year, year10, year11, family, tane, silva } = c;
    const stored = async (path: string) => (await api('GET', path)).body;
    /** Holds a write to 3 stages and to the trips it was measured at. */
    const within = (res: Res, request: string, status: number, trips: number) => {
      expect(res.status, request).toBe(status);
      expect(res.db.stages, request).toBeLessThanOrEqual(3);
      expect(res.db.trips, request).toBeLessThanOrEqual(trips);
    };

    const addFamily = await api('POST', '/families', {
      name: 'Tui',
      branchId: albany.id,
      address: '4 Kowhai Street',
    });
    within(addFamily, 'POST /families', 201, 3); // 6 trips, 5 stages
    const tui = addFamily.body as Row;
    expect(addFamily.body).toEqual(await stored(`/families/${tui.id}`));

    // A new name, a move to another branch and another billing contact, all at once.
    const changeFamily = await api('PATCH', `/families/${family.id}`, {
      updatedAt: (await stored(`/families/${family.id}`)).updatedAt,
      name: 'Perera whānau',
      branchId: albany.id,
      billingGuardianId: tane.id,
    });
    within(changeFamily, 'PATCH /families/{id}', 200, 8); // 10 trips, 8 stages
    expect(changeFamily.body).toMatchObject({ name: 'Perera whānau', billingGuardianId: tane.id });
    expect(changeFamily.body.students.map((s: { branchId: string }) => s.branchId)).toEqual([
      albany.id,
      albany.id,
    ]);
    expect(changeFamily.body).toEqual(await stored(`/families/${family.id}`));

    // The family's first guardian, who also becomes its billing contact.
    const addGuardian = await api('POST', `/families/${tui.id}/guardians`, {
      firstName: 'Ana',
      lastName: 'Tui',
      email: 'ana@example.com',
    });
    within(addGuardian, 'POST /families/{id}/guardians', 201, 3); // 4 trips, 4 stages
    const ana = addGuardian.body as Row;
    expect((await stored(`/families/${tui.id}`)).guardians).toEqual([addGuardian.body]);

    const changeGuardian = await api('PATCH', `/guardians/${ana.id}`, {
      updatedAt: ana.updatedAt,
      firstName: 'Anahera',
      phone: '+64 21 555 0100',
    });
    within(changeGuardian, 'PATCH /guardians/{id}', 200, 3); // 4 trips, 4 stages
    expect((await stored(`/families/${tui.id}`)).guardians).toEqual([changeGuardian.body]);

    const spare = await make(`/families/${tui.id}/guardians`, {
      firstName: 'Rua',
      lastName: 'Tui',
    });
    const removeGuardian = await api('DELETE', `/guardians/${spare.id}`);
    within(removeGuardian, 'DELETE /guardians/{id}', 204, 3); // 3 trips, 3 stages

    // A birth date to check against today, and a grade level for a named academic year.
    const addStudent = await api('POST', '/students', {
      familyId: tui.id,
      firstName: 'Kiri',
      lastName: 'Tui',
      dateOfBirth: '2012-05-17',
      gradeLevelId: year10.id,
      academicYearId: year.id,
    });
    within(addStudent, 'POST /students', 201, 5); // 8 trips, 7 stages
    const kiri = addStudent.body as Row;
    expect(addStudent.body).toEqual(await stored(`/students/${kiri.id}`));

    const changeStudent = await api('PATCH', `/students/${kiri.id}`, {
      updatedAt: kiri.updatedAt,
      firstName: 'Kiri-Jane',
      dateOfBirth: '2012-05-18',
      gradeLevelId: year11.id,
      academicYearId: year.id,
    });
    within(changeStudent, 'PATCH /students/{id}', 200, 6); // 9 trips, 8 stages
    expect(changeStudent.body).toMatchObject({ firstName: 'Kiri-Jane', gradeLevelId: year11.id });
    expect(changeStudent.body).toEqual(await stored(`/students/${kiri.id}`));

    // Refused while the family has a student: the count is read with the family, nothing is written.
    const refused = await api('DELETE', `/families/${tui.id}`);
    within(refused, 'DELETE /families/{id}, refused', 422, 3);

    const removeStudent = await api('DELETE', `/students/${kiri.id}`);
    within(removeStudent, 'DELETE /students/{id}', 204, 4); // 4 trips, 4 stages
    const removeFamily = await api('DELETE', `/families/${tui.id}`);
    within(removeFamily, 'DELETE /families/{id}', 204, 4); // 4 trips, 4 stages
    expect((await api('GET', `/families/${silva.id}`)).status).toBe(200);
  });
});

describe('the reads other modules call are one stage each', () => {
  it('getStudent and getFamily send everything together, for every role', async () => {
    const c = await centre();
    const org = (await db().query.orgs.findFirst({ where: (o, { eq }) => eq(o.id, c.org.id) }))!;
    /** What one call costs, on a counter of its own, with the org on the context as in a request. */
    const cost = async (read: (ctx: OrgCtx) => Promise<unknown>) => {
      const { d1, counts } = countTrips(env.DB);
      await read({ db: createDb(d1), orgId: c.org.id, actorUserId: null, org });
      return { trips: counts.trips, stages: counts.stages };
    };
    const owner: Access = { scope: 'all', role: 'owner', membershipId: 'mem_x', branchIds: null };
    const teacher: Access = { ...owner, scope: 'own', role: 'teacher', membershipId: c.teacher.id };
    const parent: Access = { ...owner, scope: 'own', role: 'parent', membershipId: c.parent.id };

    for (const access of [owner, teacher, parent]) {
      // Before: 3 trips in 2 stages, and 5 trips in 3.
      expect(await cost((ctx) => people.getStudent(ctx, access, c.mia.id))).toEqual({
        trips: 3,
        stages: 1,
      });
      expect(await cost((ctx) => people.getFamily(ctx, access, c.family.id))).toEqual({
        trips: 5,
        stages: 1,
      });
    }

    const single: ((ctx: OrgCtx) => Promise<unknown>)[] = [
      (ctx) => people.studentNames(ctx, [c.mia.id]),
      (ctx) => people.familyLabels(ctx, [c.family.id]),
      (ctx) => people.familyIdsOfStudents(ctx, [c.mia.id]),
      (ctx) => people.countFamilies(ctx, c.main.id),
      (ctx) => people.countStudentsInGrade(ctx, c.year10.id),
      (ctx) => people.studentIdsOfGuardian(ctx, c.parent.id),
      (ctx) => people.familyIdsInBranches(ctx, [c.main.id]),
    ];
    for (const read of single) expect(await cost(read)).toEqual({ trips: 1, stages: 1 });
  });
});
