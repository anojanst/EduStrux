import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string; updatedAt: string };
type Class = Row & { name: string; branchId: string; capacity: number | null };
type Student = Row & { familyId: string; firstName: string; lastName: string };
type Family = Row & { name: string; guardians: Row[]; students: Student[] };
type Session = { id: string; classId: string; className: string; date: string };
type Enrolment = Row & {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  classId: string;
  className: string;
  courseId: string;
  branchId: string;
  startDate: string;
  endDate: string | null;
  priceOverride: { amount: number; currency: string } | null;
  status: string;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

const TUE = { weekday: 2, startTime: '16:00', endTime: '17:00' };
const THU = { weekday: 4, startTime: '16:00', endTime: '17:00' };
const FRI = { weekday: 5, startTime: '09:00', endTime: '10:00' };

/**
 * An owner with a fresh org that has what an enrolment needs: a course, the Main branch and a
 * ten-week term starting next Monday, with helpers to add classes, families and students.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make<Row>('/subjects', { name: 'Mathematics' });
  const grade = await make<Row>('/grade-levels', { name: 'Year 10' });
  const course = await make<Row>('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    durationMinutes: 60,
  });
  const start = nextMonday();
  const end = addDays(start, 69);
  const year = await make<Row>('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make<Row>('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: end,
  });

  const addClass = (body: Record<string, unknown> = {}) =>
    make<Class>('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name: 'Group A',
      ...body,
    });
  const setSchedule = async (classId: string, slots: (typeof TUE)[]) => {
    const res = await api('PUT', `/classes/${classId}/schedule`, { slots });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
  };
  const addFamily = (name = 'Perera', body: Record<string, unknown> = {}) =>
    make<Family>('/families', { name, branchId: main.id, ...body });
  const addStudent = (familyId: string, body: Record<string, unknown> = {}) =>
    make<Student>('/students', { familyId, firstName: 'Aroha', lastName: 'Perera', ...body });
  /** A student in a family of their own, in the Main branch. */
  const newStudent = async (firstName = 'Aroha') =>
    addStudent((await addFamily(`${firstName}'s family`)).id, { firstName });
  const enrol = (studentId: string, classId: string, body: Record<string, unknown> = {}) =>
    make<Enrolment>('/enrolments', { studentId, classId, ...body });
  /** A member of the org with the given role, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, userId: user.userId, as };
  };
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityType: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
    }[];

  return {
    owner,
    org,
    base,
    api,
    make,
    main,
    course,
    term,
    start,
    end,
    range: `from=${start}&to=${end}&limit=200`,
    addClass,
    setSchedule,
    addFamily,
    addStudent,
    newStudent,
    enrol,
    member,
    lastAudit,
  };
}

/** Who is in what, as a caller sees it: "Mia in Main group", oldest enrolment first. */
const seen = async (as: As, query = '') =>
  (await as('GET', `/enrolments${query}`)).body.data.map(
    (e: Enrolment) => `${e.studentFirstName} in ${e.className}`,
  ) as string[];
const sessionsSeen = async (as: As, query: string) =>
  (await as('GET', `/sessions?${query}`)).body.data as Session[];

describe('enrolments', () => {
  it('enrols a student in a class, lists it, and writes an audit row', async () => {
    const { api, owner, main, course, start, addClass, newStudent, lastAudit } = await setup();
    const klass = await addClass();
    const student = await newStudent();

    const created = await api('POST', '/enrolments', { studentId: student.id, classId: klass.id });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^enr_/),
      studentId: student.id,
      studentFirstName: 'Aroha',
      studentLastName: 'Perera',
      classId: klass.id,
      className: 'Group A',
      courseId: course.id,
      branchId: main.id,
      // The term hasn't begun, so the enrolment starts with the class.
      startDate: start,
      endDate: null,
      priceOverride: null,
      status: 'active',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    expect((await api('GET', '/enrolments')).body).toEqual({
      data: [created.body],
      nextCursor: null,
    });
    const [audit] = await lastAudit();
    expect(audit).toMatchObject({
      action: 'enrolment.created',
      entityType: 'enrolment',
      entityId: created.body.id,
      actorUserId: owner.userId,
      before: null,
      after: {
        studentId: student.id,
        classId: klass.id,
        startDate: start,
        endDate: null,
        status: 'active',
      },
    });
  });

  it('starts today in a class that is already running, and takes its own dates and price', async () => {
    const { api, addClass, newStudent, enrol } = await setup();
    const running = await addClass({
      termId: null,
      startDate: addDays(today(), -14),
      name: 'Rolling',
    });
    const [aroha, kai, mia] = [
      await newStudent(),
      await newStudent('Kai'),
      await newStudent('Mia'),
    ];

    expect((await enrol(aroha.id, running.id)).startDate).toBe(today());

    // Staff can record a start in the past, a last day, and a price of this student's own.
    const dated = await enrol(kai.id, running.id, {
      startDate: addDays(today(), -7),
      endDate: addDays(today(), 30),
      priceOverride: { amount: 4000, currency: 'NZD' },
    });
    expect(dated).toMatchObject({
      startDate: addDays(today(), -7),
      endDate: addDays(today(), 30),
      priceOverride: { amount: 4000, currency: 'NZD' },
    });
    expect((await api('GET', `/enrolments?studentId=${kai.id}`)).body.data).toEqual([dated]);

    // A price of 0 is free, and null is no override.
    const free = await enrol(mia.id, running.id, {
      endDate: null,
      priceOverride: { amount: 0, currency: 'NZD' },
    });
    expect(free).toMatchObject({ endDate: null, priceOverride: { amount: 0, currency: 'NZD' } });
  });

  it('rejects a body that is missing ids, has bad dates or a price in another currency', async () => {
    const { api, start, addClass, newStudent } = await setup();
    const klass = await addClass();
    const student = await newStudent();
    const post = (body: Record<string, unknown>) =>
      api('POST', '/enrolments', { studentId: student.id, classId: klass.id, ...body });

    const empty = await api('POST', '/enrolments', {});
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.error.fields).sort()).toEqual(['classId', 'studentId']);

    const badDate = await post({ startDate: '14/10/2026' });
    expect(badDate.status).toBe(400);
    expect(Object.keys(badDate.body.error.fields)).toEqual(['startDate']);

    const backwards = await post({ startDate: addDays(start, 7), endDate: addDays(start, 6) });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.fields).toEqual({ endDate: ['Must be on or after startDate'] });
    // The same when the start is the default one: the class's first day.
    const beforeDefault = await post({ endDate: addDays(start, -1) });
    expect(beforeDefault.status).toBe(400);
    expect(beforeDefault.body.error.fields).toEqual({ endDate: ['Must be on or after startDate'] });

    const otherCurrency = await post({ priceOverride: { amount: 4000, currency: 'AUD' } });
    expect(otherCurrency.status).toBe(400);
    expect(otherCurrency.body.error.fields).toEqual({
      'priceOverride.currency': ["Must be the organisation's currency, NZD"],
    });
    const negative = await post({ priceOverride: { amount: -1, currency: 'NZD' } });
    expect(negative.status).toBe(400);
    expect(Object.keys(negative.body.error.fields)).toEqual(['priceOverride.amount']);

    expect((await api('GET', '/enrolments')).body.data).toEqual([]);
  });

  it('keeps an enrolment inside the dates of its class', async () => {
    const { api, start, end, addClass, newStudent, enrol } = await setup();
    const student = await newStudent();
    const outside = ['Outside the class dates'];

    // A class in a term runs for the term.
    const termClass = await addClass();
    const post = (classId: string, body: Record<string, unknown>) =>
      api('POST', '/enrolments', { studentId: student.id, classId, ...body });
    const early = await post(termClass.id, { startDate: addDays(start, -1) });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({
      code: 'unprocessable',
      message: `An enrolment's dates must fall inside the class's: ${start} to ${end}.`,
      fields: { startDate: outside },
    });
    const late = await post(termClass.id, { endDate: addDays(end, 1) });
    expect(late.status).toBe(422);
    expect(late.body.error.fields).toEqual({ endDate: outside });
    const after = await post(termClass.id, {
      startDate: addDays(end, 5),
      endDate: addDays(end, 6),
    });
    expect(after.body.error.fields).toEqual({ startDate: outside, endDate: outside });
    expect(await enrol(student.id, termClass.id, { startDate: end, endDate: end })).toMatchObject({
      startDate: end,
      endDate: end,
    });

    // A class's own dates narrow its term.
    const lateStarter = await addClass({ name: 'Late', startDate: addDays(start, 14) });
    expect((await post(lateStarter.id, { startDate: addDays(start, 7) })).status).toBe(422);
    expect((await enrol(student.id, lateStarter.id)).startDate).toBe(addDays(start, 14));

    // A class with no term runs from its start date until further notice.
    const rolling = await addClass({
      termId: null,
      startDate: addDays(today(), -14),
      name: 'Rolling',
    });
    const tooEarly = await post(rolling.id, { startDate: addDays(today(), -15) });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error.message).toBe(
      `An enrolment's dates must fall inside the class's: from ${addDays(today(), -14)} on.`,
    );
    expect(await enrol(student.id, rolling.id, { endDate: addDays(today(), 900) })).toMatchObject({
      startDate: today(),
      endDate: addDays(today(), 900),
    });

    // A class that has ended only takes an enrolment dated inside it.
    const finished = await addClass({
      termId: null,
      startDate: addDays(today(), -30),
      endDate: addDays(today(), -1),
      name: 'Finished',
    });
    const now = await post(finished.id, {});
    expect(now.status).toBe(422);
    expect(now.body.error.fields).toEqual({ startDate: outside });
    expect(
      (await enrol(student.id, finished.id, { startDate: addDays(today(), -10) })).startDate,
    ).toBe(addDays(today(), -10));
  });

  it('refuses a second active enrolment of the same student in a class', async () => {
    const { api, addClass, addFamily, addStudent, enrol } = await setup();
    const klass = await addClass();
    const other = await addClass({ name: 'Group B' });
    const family = await addFamily();
    const aroha = await addStudent(family.id);
    const sibling = await addStudent(family.id, { firstName: 'Kai' });
    await enrol(aroha.id, klass.id);

    const again = await api('POST', '/enrolments', { studentId: aroha.id, classId: klass.id });
    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({
      code: 'conflict',
      message: 'This student is already enrolled in this class.',
      fields: { _: ['Already enrolled'] },
    });

    // Their sibling can join the class, and they can join another one.
    await enrol(sibling.id, klass.id);
    await enrol(aroha.id, other.id);
    expect((await api('GET', `/enrolments?classId=${klass.id}`)).body.data).toHaveLength(2);
    expect((await api('GET', `/enrolments?studentId=${aroha.id}`)).body.data).toHaveLength(2);
  });

  it('refuses once the class is full, counting the enrolments that have not ended', async () => {
    const { api, start, addClass, newStudent, enrol } = await setup();
    const klass = await addClass({ capacity: 2 });
    const [a, b, c, d] = [
      await newStudent('Ana'),
      await newStudent('Ben'),
      await newStudent('Cal'),
      await newStudent('Dee'),
    ];
    await enrol(a.id, klass.id);
    // Ben only stays for the first week.
    await enrol(b.id, klass.id, { endDate: addDays(start, 6) });
    const post = (studentId: string, startDate: string) =>
      api('POST', '/enrolments', { studentId, classId: klass.id, startDate });

    const full = await post(c.id, start);
    expect(full.status).toBe(422);
    expect(full.body.error).toEqual({
      code: 'unprocessable',
      message: 'This class is full: all 2 place(s) are taken.',
      fields: { classId: ['Full'] },
    });
    // Ben's place is free from the day after he leaves.
    expect((await post(c.id, addDays(start, 7))).status).toBe(201);
    // Cal starts later, but holds his place from now on.
    expect((await post(d.id, start)).status).toBe(422);
    expect((await post(d.id, addDays(start, 7))).status).toBe(422);

    // A bigger class, or one with no limit, takes Dee.
    const grown = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      capacity: 3,
    });
    expect(grown.status).toBe(200);
    expect((await post(d.id, addDays(start, 7))).status).toBe(201);
    const open = await addClass({ name: 'No limit' });
    for (const student of [a, b, c, d]) await enrol(student.id, open.id);
    expect((await api('GET', `/enrolments?classId=${open.id}`)).body.data).toHaveLength(4);
  });

  it('returns 404 for a student or class the org does not have', async () => {
    const { api, addClass, newStudent } = await setup();
    const klass = await addClass();
    const student = await newStudent();

    const results = await Promise.all([
      api('POST', '/enrolments', { studentId: 'stu_nope', classId: klass.id }),
      api('POST', '/enrolments', { studentId: student.id, classId: 'cls_nope' }),
      api('GET', '/enrolments?studentId=stu_nope'),
      api('GET', '/enrolments?classId=cls_nope'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(results.map((r) => r.body.error.message)).toEqual([
      'Student not found',
      'Class not found',
      'Student not found',
      'Class not found',
    ]);

    // Deleted ones are gone too.
    await api('DELETE', `/students/${student.id}`);
    const gone = await api('POST', '/enrolments', { studentId: student.id, classId: klass.id });
    expect(gone.status).toBe(404);
  });

  it('lists oldest first, filters by student and class, and pages with a cursor', async () => {
    const { api, addClass, newStudent, enrol } = await setup();
    const [groupA, groupB] = [await addClass(), await addClass({ name: 'Group B' })];
    const [ana, ben] = [await newStudent('Ana'), await newStudent('Ben')];
    const anaA = await enrol(ana.id, groupA.id);
    const benA = await enrol(ben.id, groupA.id);
    const anaB = await enrol(ana.id, groupB.id);
    const ids = async (query: string) =>
      (await api('GET', `/enrolments${query}`)).body.data.map((e: Enrolment) => e.id) as string[];

    expect(await ids('')).toEqual([anaA.id, benA.id, anaB.id]);
    expect(await ids(`?classId=${groupA.id}`)).toEqual([anaA.id, benA.id]);
    expect(await ids(`?studentId=${ana.id}`)).toEqual([anaA.id, anaB.id]);
    expect(await ids(`?studentId=${ben.id}&classId=${groupB.id}`)).toEqual([]);

    const first = await api('GET', '/enrolments?limit=2');
    expect(first.body.data.map((e: Enrolment) => e.id)).toEqual([anaA.id, benA.id]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await api('GET', `/enrolments?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body).toMatchObject({ data: [{ id: anaB.id }], nextCursor: null });
  });
});

describe('records an enrolment uses', () => {
  it('refuses to delete a class or a student that has enrolments', async () => {
    const { api, range, addClass, setSchedule, newStudent, enrol } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE]);
    const student = await newStudent();
    await enrol(student.id, klass.id);

    const classRefused = await api('DELETE', `/classes/${klass.id}`);
    expect(classRefused.status).toBe(422);
    expect(classRefused.body.error.message).toBe(
      "This class has 1 enrolment(s), so it can't be deleted.",
    );
    const studentRefused = await api('DELETE', `/students/${student.id}`);
    expect(studentRefused.status).toBe(422);
    expect(studentRefused.body.error.message).toBe(
      "This student has 1 enrolment(s), so they can't be deleted.",
    );
    expect(await sessionsSeen(api, `${range}&classId=${klass.id}`)).toHaveLength(10);
    expect((await api('GET', `/students/${student.id}`)).status).toBe(200);

    // A class nobody is in and a student in no class still delete.
    const empty = await addClass({ name: 'Empty' });
    const unenrolled = await newStudent('Kai');
    expect((await api('DELETE', `/classes/${empty.id}`)).status).toBe(204);
    expect((await api('DELETE', `/students/${unenrolled.id}`)).status).toBe(204);
  });
});

describe('a student’s timetable', () => {
  it('lists the sessions of their classes, on the dates each enrolment covers', async () => {
    const { api, start, range, addClass, setSchedule, newStudent, enrol } = await setup();
    const [tuesdays, thursdays, fridays] = [
      await addClass({ name: 'Tuesdays' }),
      await addClass({ name: 'Thursdays' }),
      await addClass({ name: 'Fridays' }),
    ];
    await setSchedule(tuesdays.id, [TUE]);
    await setSchedule(thursdays.id, [THU]);
    await setSchedule(fridays.id, [FRI]);
    const student = await newStudent();
    const other = await newStudent('Kai');

    // In the Tuesday class all term; in the Thursday one for weeks 3 to 5; never on Fridays.
    await enrol(student.id, tuesdays.id);
    await enrol(student.id, thursdays.id, {
      startDate: addDays(start, 14),
      endDate: addDays(start, 34),
    });
    await enrol(other.id, fridays.id);

    const timetable = await sessionsSeen(api, `${range}&studentId=${student.id}`);
    expect(timetable.filter((s) => s.className === 'Tuesdays')).toHaveLength(10);
    expect(timetable.filter((s) => s.className === 'Thursdays').map((s) => s.date)).toEqual([
      addDays(start, 17),
      addDays(start, 24),
      addDays(start, 31),
    ]);
    expect(timetable).toHaveLength(13);
    // Still in date order, and it combines with the other filters.
    expect(timetable.map((s) => s.date)).toEqual(timetable.map((s) => s.date).sort());
    expect(
      await sessionsSeen(api, `${range}&studentId=${student.id}&classId=${thursdays.id}`),
    ).toHaveLength(3);
    expect(await sessionsSeen(api, `${range}&studentId=${other.id}`)).toHaveLength(10);

    // A student in no class has an empty timetable; an unknown one is 404.
    const idle = await newStudent('Mia');
    expect(await sessionsSeen(api, `${range}&studentId=${idle.id}`)).toEqual([]);
    expect((await api('GET', `/sessions?${range}&studentId=stu_nope`)).status).toBe(404);
  });
});

describe('org isolation', () => {
  it("can't read or add to another org's enrolments, or enrol across orgs", async () => {
    const alice = await setup();
    const klass = await alice.addClass();
    const student = await alice.newStudent();
    await alice.enrol(student.id, klass.id);
    const bob = await setup();
    const bobClass = await bob.addClass();
    const bobStudent = await bob.newStudent('Kai');
    const body = { studentId: student.id, classId: klass.id };

    const results = await Promise.all([
      bob.api('POST', '/enrolments', body),
      bob.api('POST', '/enrolments', { studentId: bobStudent.id, classId: klass.id }),
      bob.api('POST', '/enrolments', { studentId: student.id, classId: bobClass.id }),
      bob.api('GET', `/enrolments?classId=${klass.id}`),
      bob.api('GET', `/enrolments?studentId=${student.id}`),
      bob.api('GET', `/sessions?${alice.range}&studentId=${student.id}`),
      call('GET', `${alice.base}/enrolments`, { token: bob.owner.token }),
      call('POST', `${alice.base}/enrolments`, { token: bob.owner.token, body }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(404));

    expect((await bob.api('GET', '/enrolments')).body.data).toEqual([]);
    expect(await seen(alice.api)).toEqual(['Aroha in Group A']);
  });
});

describe('permissions', () => {
  /**
   * Two branches, each with a class and a family. Mia, of the Main branch, is in both classes
   * and Ari, of Albany, in the Albany one. Sam is Mia's brother and in no class. `teacher`
   * teaches the Main class.
   */
  async function twoBranches() {
    const org = await setup();
    const albany = await org.make<Row>('/branches', { name: 'Albany' });
    const teacher = await org.member('teacher');
    const mainClass = await org.addClass({ name: 'Main group', teacherId: teacher.id });
    const albanyClass = await org.addClass({ name: 'Albany group', branchId: albany.id });
    await org.setSchedule(mainClass.id, [TUE]);
    await org.setSchedule(albanyClass.id, [THU]);
    const mainFamily = await org.addFamily('Main family');
    const mainGuardian = await org.make<Row>(`/families/${mainFamily.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Perera',
    });
    const mia = await org.addStudent(mainFamily.id, { firstName: 'Mia' });
    const sam = await org.addStudent(mainFamily.id, { firstName: 'Sam' });
    const albanyFamily = await org.addFamily('Albany family', { branchId: albany.id });
    const ari = await org.addStudent(albanyFamily.id, { firstName: 'Ari' });
    await org.enrol(mia.id, mainClass.id);
    await org.enrol(mia.id, albanyClass.id);
    await org.enrol(ari.id, albanyClass.id);
    return {
      ...org,
      albany,
      teacher,
      mainClass,
      albanyClass,
      mainFamily,
      mainGuardian,
      mia,
      sam,
      albanyFamily,
      ari,
    };
  }
  const everything = ['Mia in Main group', 'Mia in Albany group', 'Ari in Albany group'];
  const classNames = async (as: As) =>
    (await as('GET', '/classes')).body.data.map((k: Class) => k.name) as string[];
  const studentNames = async (as: As) =>
    (await as('GET', '/students')).body.data.map((s: Student) => s.firstName) as string[];
  const classesIn = (sessions: Session[]) => [...new Set(sessions.map((s) => s.className))].sort();

  it('lets the owner see every enrolment', async () => {
    const t = await twoBranches();
    expect(await seen(t.api)).toEqual(everything);
  });

  it('refuses an accountant on every route', async () => {
    const t = await twoBranches();
    const { as } = await t.member('accountant');
    const results = await Promise.all([
      as('GET', '/enrolments'),
      as('GET', `/enrolments?classId=${t.mainClass.id}`),
      as('POST', '/enrolments', { studentId: t.sam.id, classId: t.mainClass.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  it('lets a teacher read the classes they teach and the students in them, and enrol nobody', async () => {
    const t = await twoBranches();
    const { as } = t.teacher;

    // Only their own class's enrolments: not Mia's place in someone else's class.
    expect(await seen(as)).toEqual(['Mia in Main group']);
    expect(await seen(as, `?studentId=${t.mia.id}`)).toEqual(['Mia in Main group']);
    expect((await as('GET', `/enrolments?classId=${t.albanyClass.id}`)).status).toBe(404);
    expect((await as('GET', `/enrolments?studentId=${t.ari.id}`)).status).toBe(404);

    // "Own classes" for families and students: the students enrolled in those classes, with
    // their family and its guardians, but not a brother they don't teach.
    expect(await studentNames(as)).toEqual(['Mia']);
    expect((await as('GET', `/students/${t.mia.id}`)).status).toBe(200);
    expect((await as('GET', `/students/${t.sam.id}`)).status).toBe(404);
    expect((await as('GET', `/students/${t.ari.id}`)).status).toBe(404);
    const families = (await as('GET', '/families')).body.data as Family[];
    expect(families.map((f) => f.name)).toEqual(['Main family']);
    expect(families[0]!.students.map((s) => s.firstName)).toEqual(['Mia']);
    expect(families[0]!.guardians.map((g) => g.id)).toEqual([t.mainGuardian.id]);
    const family = await as('GET', `/families/${t.mainFamily.id}`);
    expect(family.body.students.map((s: Student) => s.firstName)).toEqual(['Mia']);
    expect((await as('GET', `/families/${t.albanyFamily.id}`)).status).toBe(404);
    expect((await as('GET', `/students?familyId=${t.albanyFamily.id}`)).status).toBe(404);

    // Mia's timetable, as far as this teacher's classes go.
    expect(classesIn(await sessionsSeen(as, `${t.range}&studentId=${t.mia.id}`))).toEqual([
      'Main group',
    ]);
    expect((await as('GET', `/sessions?${t.range}&studentId=${t.ari.id}`)).status).toBe(404);

    const write = await as('POST', '/enrolments', { studentId: t.sam.id, classId: t.mainClass.id });
    expect(write.status).toBe(403);
    expect(await seen(t.api)).toEqual(everything);

    // A student who joins their class comes into view.
    await t.enrol(t.sam.id, t.mainClass.id);
    expect(await studentNames(as)).toEqual(['Mia', 'Sam']);
  });

  it('lets a parent read their own children’s enrolments, classes and sessions, and enrol nobody', async () => {
    const t = await twoBranches();
    const other = await t.addClass({ name: 'Other group' });
    await t.setSchedule(other.id, [FRI]);
    const parent = await t.member('parent');
    const stranger = await t.member('parent');
    // What accepting an invite will do: tie the guardian to the parent's membership.
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, t.mainGuardian.id));
    const { as } = parent;

    expect(await seen(as)).toEqual(['Mia in Main group', 'Mia in Albany group']);
    // The Albany class's roster shows them their own child only, not Ari.
    expect(await seen(as, `?classId=${t.albanyClass.id}`)).toEqual(['Mia in Albany group']);
    expect(await seen(as, `?studentId=${t.sam.id}`)).toEqual([]);
    expect((await as('GET', `/enrolments?studentId=${t.ari.id}`)).status).toBe(404);
    expect((await as('GET', `/enrolments?classId=${other.id}`)).status).toBe(404);

    // "Own children" for classes and sessions: the classes a child of theirs is enrolled in.
    expect(await classNames(as)).toEqual(['Main group', 'Albany group']);
    expect((await as('GET', `/classes/${t.mainClass.id}`)).status).toBe(200);
    expect((await as('GET', `/classes/${other.id}`)).status).toBe(404);
    const sessions = await sessionsSeen(as, t.range);
    expect(classesIn(sessions)).toEqual(['Albany group', 'Main group']);
    expect(sessions).toHaveLength(20);
    expect((await as('GET', `/sessions/${sessions[0]!.id}`)).status).toBe(200);
    expect(await sessionsSeen(as, `${t.range}&studentId=${t.mia.id}`)).toHaveLength(20);
    expect((await as('GET', `/sessions?${t.range}&studentId=${t.ari.id}`)).status).toBe(404);

    const write = await as('POST', '/enrolments', { studentId: t.sam.id, classId: t.mainClass.id });
    expect(write.status).toBe(403);

    // A parent who isn't tied to a guardian sees nothing.
    expect(await seen(stranger.as)).toEqual([]);
    expect(await classNames(stranger.as)).toEqual([]);
    expect(await sessionsSeen(stranger.as, t.range)).toEqual([]);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'keeps a %s limited to one branch to that branch’s students and classes',
    async (role) => {
      const t = await twoBranches();
      const staff = await t.member(role, [t.albany.id]);
      const { as } = staff;

      // Their class's roster names Mia, whose family belongs to the Main branch; her record
      // and her place in the Main class stay out of their reach.
      expect(await seen(as)).toEqual(['Mia in Albany group', 'Ari in Albany group']);
      expect(await seen(as, `?classId=${t.albanyClass.id}`)).toEqual([
        'Mia in Albany group',
        'Ari in Albany group',
      ]);
      const outside = await Promise.all([
        as('GET', `/enrolments?classId=${t.mainClass.id}`),
        as('GET', `/enrolments?studentId=${t.mia.id}`),
        as('GET', `/students/${t.mia.id}`),
        as('GET', `/sessions?${t.range}&studentId=${t.mia.id}`),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404, 404, 404]);

      // To enrol, they must reach both the student and the class.
      const crossBranch = await Promise.all([
        as('POST', '/enrolments', { studentId: t.sam.id, classId: t.albanyClass.id }),
        as('POST', '/enrolments', { studentId: t.ari.id, classId: t.mainClass.id }),
        as('POST', '/enrolments', { studentId: t.sam.id, classId: t.mainClass.id }),
      ]);
      expect(crossBranch.map((r) => r.status)).toEqual([404, 404, 404]);
      expect(crossBranch.map((r) => r.body.error.message)).toEqual([
        'Student not found',
        'Class not found',
        'Student not found',
      ]);
      expect(await seen(t.api)).toEqual(everything);

      // Inside their branch they enrol, and the audit row names them.
      const kiri = await as('POST', '/students', {
        familyId: t.albanyFamily.id,
        firstName: 'Kiri',
        lastName: 'Perera',
      });
      const created = await as('POST', '/enrolments', {
        studentId: kiri.body.id,
        classId: t.albanyClass.id,
      });
      expect(created.status).toBe(201);
      expect((await t.lastAudit()).map((e) => [e.action, e.actorUserId])).toEqual([
        ['enrolment.created', staff.userId],
      ]);

      // The owner enrols Ari in the Main class. Ari is their branch's student, so they see
      // that enrolment too, though not the class itself.
      await t.enrol(t.ari.id, t.mainClass.id);
      expect(await seen(as, `?studentId=${t.ari.id}`)).toEqual([
        'Ari in Albany group',
        'Ari in Main group',
      ]);
      expect((await as('GET', `/classes/${t.mainClass.id}`)).status).toBe(404);
    },
  );

  it('lets branch staff with no branch limit enrol across branches', async () => {
    const t = await twoBranches();
    const { as } = await t.member('front_desk');
    expect(await seen(as)).toEqual(everything);
    const created = await as('POST', '/enrolments', {
      studentId: t.sam.id,
      classId: t.albanyClass.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ studentFirstName: 'Sam', branchId: t.albany.id });
  });

  it('shows staff limited to no branches nothing', async () => {
    const t = await twoBranches();
    const { as } = await t.member('branch_manager', []);
    expect(await seen(as)).toEqual([]);
    const write = await as('POST', '/enrolments', {
      studentId: t.ari.id,
      classId: t.albanyClass.id,
    });
    expect(write.status).toBe(404);
  });
});
