import { attendance, enrolments, guardians, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
const yesterday = () => addDays(today(), -1);
/** The day every class in these tests began, and every enrolment unless it says otherwise. */
const firstDay = () => addDays(today(), -30);

type Row = { id: string; updatedAt: string };
type Class = Row & { name: string; branchId: string };
type Student = Row & { familyId: string; firstName: string; lastName: string };
type Family = Row & { name: string };
type Status = 'present' | 'absent' | 'late' | 'excused' | null;
type Mark = { studentId: string; status: Status };
type AttendanceRecord = Mark & {
  studentFirstName: string;
  studentLastName: string;
  markedAt: string | null;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type SessionValues = {
  date?: string;
  startTime?: string;
  endTime?: string;
  status?: 'scheduled' | 'cancelled';
  teacherMembershipId?: string;
};

/**
 * An owner with a fresh org that has what attendance needs: a course and the Main branch, with
 * helpers to add classes that began a month ago, their sessions, families, students and
 * enrolments.
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

  /** An open-ended class that has been running for a month. */
  const addClass = (body: Record<string, unknown> = {}) =>
    make<Class>('/classes', {
      courseId: course.id,
      branchId: main.id,
      name: 'Group A',
      startDate: firstDay(),
      ...body,
    });
  /**
   * A session written straight to the database: the generator only makes sessions that haven't
   * started, and nothing cancels one yet. Yesterday at 4 pm unless told otherwise.
   */
  const addSession = async (classId: string, values: SessionValues = {}) => {
    const id = newId('session');
    await db()
      .insert(sessions)
      .values({
        id,
        orgId: org.id,
        classId,
        date: yesterday(),
        startTime: '16:00',
        endTime: '17:00',
        ...values,
      });
    return id;
  };
  const addFamily = (name = 'Perera', body: Record<string, unknown> = {}) =>
    make<Family>('/families', { name, branchId: main.id, ...body });
  const addStudent = (familyId: string, body: Record<string, unknown> = {}) =>
    make<Student>('/students', { familyId, firstName: 'Aroha', lastName: 'Perera', ...body });
  /** A student in a family of their own, in the Main branch. */
  const newStudent = async (firstName = 'Aroha', lastName = 'Perera') =>
    addStudent((await addFamily(`${firstName}'s family`)).id, { firstName, lastName });
  /** Enrolled since the class began, unless the body says otherwise. */
  const enrol = (studentId: string, classId: string, body: Record<string, unknown> = {}) =>
    make<Row>('/enrolments', { studentId, classId, startDate: firstDay(), ...body });
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
      id: string;
      action: string;
      entityType: string;
      entityId: string;
      actorUserId: string;
      before: { records: Mark[] } | null;
      after: { records: Mark[] };
    }[];
  /** The marks stored for a session, cleared ones included. */
  const rowsOf = (sessionId: string) =>
    db()
      .select()
      .from(attendance)
      .where(and(eq(attendance.orgId, org.id), eq(attendance.sessionId, sessionId)));

  return {
    owner,
    org,
    base,
    api,
    make,
    main,
    addClass,
    addSession,
    addFamily,
    addStudent,
    newStudent,
    enrol,
    member,
    lastAudit,
    rowsOf,
  };
}

const path = (sessionId: string) => `/sessions/${sessionId}/attendance`;
const mark = (as: As, sessionId: string, records: Mark[]) =>
  as('PUT', path(sessionId), { records });
/** A session's roster as a caller sees it: "Aroha: present", "Ben: -" for not marked. */
const seen = async (as: As, sessionId: string) =>
  (await as('GET', path(sessionId))).body.records.map(
    (r: AttendanceRecord) => `${r.studentFirstName}: ${r.status ?? '-'}`,
  ) as string[];

/** A class with a session yesterday and two students enrolled: Ben Ngata and Aroha Perera. */
async function classOfTwo() {
  const org = await setup();
  const klass = await org.addClass();
  const session = await org.addSession(klass.id);
  const aroha = await org.newStudent('Aroha', 'Perera');
  const ben = await org.newStudent('Ben', 'Ngata');
  await org.enrol(aroha.id, klass.id);
  await org.enrol(ben.id, klass.id);
  return { ...org, klass, session, aroha, ben };
}

describe('attendance', () => {
  it('lists who is expected, marks them, and writes one audit row', async () => {
    const { api, owner, session, aroha, ben, lastAudit, rowsOf } = await classOfTwo();

    const unmarked = await api('GET', path(session));
    expect(unmarked.status).toBe(200);
    expect(unmarked.body).toEqual({
      sessionId: session,
      // By last name: Ngata before Perera.
      records: [
        {
          studentId: ben.id,
          studentFirstName: 'Ben',
          studentLastName: 'Ngata',
          status: null,
          markedAt: null,
          absenceNotice: null,
        },
        {
          studentId: aroha.id,
          studentFirstName: 'Aroha',
          studentLastName: 'Perera',
          status: null,
          markedAt: null,
          absenceNotice: null,
        },
      ],
    });

    const records: Mark[] = [
      { studentId: aroha.id, status: 'absent' },
      { studentId: ben.id, status: 'present' },
    ];
    const marked = await mark(api, session, records);
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({
      sessionId: session,
      records: [
        { ...unmarked.body.records[0], status: 'present', markedAt: expect.any(String) },
        { ...unmarked.body.records[1], status: 'absent', markedAt: expect.any(String) },
      ],
    });
    expect((await api('GET', path(session))).body).toEqual(marked.body);

    // One audit row for the whole request, not one per student.
    const [audit, previous] = await lastAudit(2);
    expect(audit).toMatchObject({
      action: 'attendance.marked',
      entityType: 'session',
      entityId: session,
      actorUserId: owner.userId,
      before: {
        records: [
          { studentId: aroha.id, status: null },
          { studentId: ben.id, status: null },
        ],
      },
      after: { records },
    });
    expect(previous!.action).not.toBe('attendance.marked');
    expect((await rowsOf(session)).map((row) => row.id)).toEqual([
      expect.stringMatching(/^att_/),
      expect.stringMatching(/^att_/),
    ]);
  });

  it('marks one student at a time, changes and clears a mark, and leaves the rest alone', async () => {
    const { api, session, aroha, ben, lastAudit, rowsOf } = await classOfTwo();
    const tap = async (studentId: string, status: Status) => {
      const res = await mark(api, session, [{ studentId, status }]);
      expect(res.status).toBe(200);
      const [audit] = await lastAudit();
      return { before: audit!.before!.records, after: audit!.after.records };
    };

    await tap(ben.id, 'present');
    expect(await seen(api, session)).toEqual(['Ben: present', 'Aroha: -']);
    await tap(aroha.id, 'late');
    expect(await seen(api, session)).toEqual(['Ben: present', 'Aroha: late']);

    // A changed mark keeps its row, and the audit row says what it was.
    const [benRow] = (await rowsOf(session)).filter((row) => row.studentId === ben.id);
    expect(await tap(ben.id, 'excused')).toEqual({
      before: [{ studentId: ben.id, status: 'present' }],
      after: [{ studentId: ben.id, status: 'excused' }],
    });
    expect(await seen(api, session)).toEqual(['Ben: excused', 'Aroha: late']);
    const benRows = (await rowsOf(session)).filter((row) => row.studentId === ben.id);
    expect(benRows).toHaveLength(1);
    expect(benRows[0]).toMatchObject({ id: benRow!.id, createdAt: benRow!.createdAt });
    expect(benRows[0]!.updatedAt >= benRow!.updatedAt).toBe(true);

    // null clears a mark; the student stays on the roster and can be marked again.
    expect(await tap(aroha.id, null)).toEqual({
      before: [{ studentId: aroha.id, status: 'late' }],
      after: [{ studentId: aroha.id, status: null }],
    });
    const cleared = await api('GET', path(session));
    expect(cleared.body.records[1]).toMatchObject({ status: null, markedAt: null });
    await tap(aroha.id, 'absent');
    expect(await seen(api, session)).toEqual(['Ben: excused', 'Aroha: absent']);
    const arohaRows = (await rowsOf(session)).filter((row) => row.studentId === aroha.id);
    expect(arohaRows.map((row) => [row.status, row.deletedAt !== null]).sort()).toEqual([
      ['absent', false],
      ['late', true],
    ]);
  });

  it('writes nothing when the marks sent are already in place', async () => {
    const { api, session, aroha, ben, lastAudit, rowsOf } = await classOfTwo();

    // Clearing a student who was never marked changes nothing.
    const [enrolled] = await lastAudit();
    const cleared = await mark(api, session, [{ studentId: aroha.id, status: null }]);
    expect(cleared.status).toBe(200);
    expect((await lastAudit())[0]!.id).toBe(enrolled!.id);
    expect(await rowsOf(session)).toEqual([]);

    const records: Mark[] = [
      { studentId: aroha.id, status: 'present' },
      { studentId: ben.id, status: 'present' },
    ];
    const first = await mark(api, session, records);
    const [audit] = await lastAudit();

    // The same marks again: the same response, `markedAt` included, and no new audit row.
    const again = await mark(api, session, records);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await lastAudit())[0]!.id).toBe(audit!.id);

    // Only the students whose status changed are in the audit row.
    await mark(api, session, [
      { studentId: aroha.id, status: 'present' },
      { studentId: ben.id, status: 'late' },
    ]);
    const [changed] = await lastAudit();
    expect(changed!.id).not.toBe(audit!.id);
    expect(changed).toMatchObject({
      before: { records: [{ studentId: ben.id, status: 'present' }] },
      after: { records: [{ studentId: ben.id, status: 'late' }] },
    });
  });

  it('rejects a body with no records, an unknown status or a student listed twice', async () => {
    const { api, session, aroha, ben, rowsOf } = await classOfTwo();

    const bad = await Promise.all([
      api('PUT', path(session), {}),
      api('PUT', path(session), { records: [] }),
      api('PUT', path(session), { records: [{ studentId: aroha.id, status: 'sick' }] }),
      api('PUT', path(session), { records: [{ studentId: aroha.id }] }),
      api('PUT', path(session), { records: [{ status: 'present' }] }),
      mark(api, session, [
        { studentId: aroha.id, status: 'present' },
        { studentId: ben.id, status: 'present' },
        { studentId: aroha.id, status: 'late' },
      ]),
    ]);
    expect(bad.map((r) => [r.status, r.body.error.code, Object.keys(r.body.error.fields)])).toEqual(
      [
        [400, 'validation_failed', ['records']],
        [400, 'validation_failed', ['records']],
        [400, 'validation_failed', ['records.0.status']],
        [400, 'validation_failed', ['records.0.status']],
        [400, 'validation_failed', ['records.0.studentId']],
        [400, 'validation_failed', ['records.2.studentId']],
      ],
    );
    expect(bad[5]!.body.error.fields['records.2.studentId']).toEqual(['Listed more than once']);
    expect(await rowsOf(session)).toEqual([]);
  });

  it('can be marked from the day of the session, not before', async () => {
    const { api, klass, aroha, addSession } = await classOfTwo();
    const lastWeek = await addSession(klass.id, { date: addDays(today(), -7) });
    // Late tonight: it hasn't started, but it is today's.
    const tonight = await addSession(klass.id, {
      date: today(),
      startTime: '23:58',
      endTime: '23:59',
    });
    const tomorrow = await addSession(klass.id, { date: addDays(today(), 1) });
    const records: Mark[] = [{ studentId: aroha.id, status: 'present' }];

    expect((await mark(api, lastWeek, records)).status).toBe(200);
    expect((await mark(api, tonight, records)).status).toBe(200);

    const early = await mark(api, tomorrow, records);
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({
      code: 'unprocessable',
      message: `Attendance can be marked from the day of the session, ${addDays(today(), 1)}, not before.`,
    });
    // Its roster can already be read.
    expect(await seen(api, tomorrow)).toEqual(['Ben: -', 'Aroha: -']);
  });

  it('refuses to mark a cancelled session', async () => {
    const { api, klass, aroha, addSession, rowsOf } = await classOfTwo();
    const cancelled = await addSession(klass.id, { startTime: '18:00', status: 'cancelled' });

    const res = await mark(api, cancelled, [{ studentId: aroha.id, status: 'absent' }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable');
    expect(await rowsOf(cancelled)).toEqual([]);
    expect(await seen(api, cancelled)).toEqual(['Ben: -', 'Aroha: -']);
  });

  it('expects only the students whose enrolment covers the date of the session', async () => {
    const { api, klass, session, aroha, addClass, addSession, newStudent, enrol, rowsOf } =
      await classOfTwo();
    const earlier = await addSession(klass.id, { date: addDays(today(), -8) });
    const tonight = await addSession(klass.id, { date: today() });
    // Cara left a week ago and Dan starts today. Eli is in another class; Finn is in none.
    const cara = await newStudent('Cara', 'Tane');
    const dan = await newStudent('Dan', 'Adams');
    const eli = await newStudent('Eli', 'Brown');
    const finn = await newStudent('Finn', 'Cole');
    await enrol(cara.id, klass.id, { endDate: addDays(today(), -7) });
    await enrol(dan.id, klass.id, { startDate: today() });
    const other = await addClass({ name: 'Group B' });
    await enrol(eli.id, other.id);

    expect(await seen(api, earlier)).toEqual(['Ben: -', 'Aroha: -', 'Cara: -']);
    expect(await seen(api, session)).toEqual(['Ben: -', 'Aroha: -']);
    expect(await seen(api, tonight)).toEqual(['Dan: -', 'Ben: -', 'Aroha: -']);

    // Anyone else can't be marked, and a request with one of them marks nobody.
    const res = await mark(api, session, [
      { studentId: aroha.id, status: 'present' },
      { studentId: cara.id, status: 'present' },
      { studentId: dan.id, status: 'absent' },
      { studentId: eli.id, status: 'present' },
      { studentId: finn.id, status: 'present' },
      { studentId: 'stu_nope', status: 'present' },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable');
    expect(res.body.error.fields).toEqual({
      'records.1.studentId': ['Not enrolled for this session'],
      'records.2.studentId': ['Not enrolled for this session'],
      'records.3.studentId': ['Not enrolled for this session'],
      'records.4.studentId': ['Not enrolled for this session'],
      'records.5.studentId': ['Not enrolled for this session'],
    });
    expect(await rowsOf(session)).toEqual([]);

    expect((await mark(api, earlier, [{ studentId: cara.id, status: 'late' }])).status).toBe(200);
    expect((await mark(api, tonight, [{ studentId: dan.id, status: 'present' }])).status).toBe(200);
  });

  it('keeps a student who was marked on the roster after their enrolment stops covering it', async () => {
    const { api, org, klass, session, aroha } = await classOfTwo();
    await mark(api, session, [{ studentId: aroha.id, status: 'absent' }]);
    // What a withdrawal will do: the enrolment now ends before the session.
    await db()
      .update(enrolments)
      .set({ endDate: addDays(today(), -10) })
      .where(
        and(
          eq(enrolments.orgId, org.id),
          eq(enrolments.studentId, aroha.id),
          eq(enrolments.classId, klass.id),
        ),
      );

    expect(await seen(api, session)).toEqual(['Ben: -', 'Aroha: absent']);
    // Their mark can still be corrected, and cleared; once cleared they are off the roster.
    expect((await mark(api, session, [{ studentId: aroha.id, status: 'excused' }])).status).toBe(
      200,
    );
    expect(await seen(api, session)).toEqual(['Ben: -', 'Aroha: excused']);
    expect((await mark(api, session, [{ studentId: aroha.id, status: null }])).status).toBe(200);
    expect(await seen(api, session)).toEqual(['Ben: -']);
    expect((await mark(api, session, [{ studentId: aroha.id, status: 'present' }])).status).toBe(
      422,
    );
  });

  it('lists the roster by last name, then first name, whatever the case or accents', async () => {
    const { api, addClass, addSession, newStudent, enrol } = await setup();
    const klass = await addClass();
    const session = await addSession(klass.id);
    for (const [firstName, lastName] of [
      ['Zoe', 'adams'],
      ['amy', 'Baker'],
      ['Ánna', 'baker'],
      ['Bo', 'Ädams'],
    ]) {
      await enrol((await newStudent(firstName, lastName)).id, klass.id);
    }
    expect(await seen(api, session)).toEqual(['Bo: -', 'Zoe: -', 'amy: -', 'Ánna: -']);
  });

  it('returns 404 for a session the org does not have', async () => {
    const { api, aroha } = await classOfTwo();
    const results = await Promise.all([
      api('GET', path('ses_nope')),
      mark(api, 'ses_nope', [{ studentId: aroha.id, status: 'present' }]),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404]);
    expect(results.map((r) => r.body.error.message)).toEqual([
      'Session not found',
      'Session not found',
    ]);
  });
});

describe('org isolation', () => {
  it("can't read or mark another org's sessions, or mark another org's students", async () => {
    const alice = await classOfTwo();
    const bob = await classOfTwo();
    const records: Mark[] = [{ studentId: alice.aroha.id, status: 'present' }];

    const results = await Promise.all([
      bob.api('GET', path(alice.session)),
      mark(bob.api, alice.session, records),
      mark(bob.api, alice.session, [{ studentId: bob.aroha.id, status: 'present' }]),
      call('GET', `${alice.base}${path(alice.session)}`, { token: bob.owner.token }),
      call('PUT', `${alice.base}${path(alice.session)}`, {
        token: bob.owner.token,
        body: { records },
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(404));

    // Another org's student isn't on the roster, so it is refused like any stranger.
    const crossed = await mark(bob.api, bob.session, records);
    expect(crossed.status).toBe(422);
    expect(crossed.body.error.fields).toEqual({
      'records.0.studentId': ['Not enrolled for this session'],
    });
    expect(await alice.rowsOf(alice.session)).toEqual([]);
    expect(await bob.rowsOf(bob.session)).toEqual([]);
  });
});

describe('permissions', () => {
  /**
   * Two branches, each with a class that met yesterday. Mia, of the Main branch, is in both
   * classes and Ari, of Albany, in the Albany one. `teacher` teaches the Main class.
   */
  async function twoBranches() {
    const org = await setup();
    const albany = await org.make<Row>('/branches', { name: 'Albany' });
    const teacher = await org.member('teacher');
    const mainClass = await org.addClass({ name: 'Main group', teacherId: teacher.id });
    const albanyClass = await org.addClass({ name: 'Albany group', branchId: albany.id });
    const mainSession = await org.addSession(mainClass.id);
    const albanySession = await org.addSession(albanyClass.id);
    const mainFamily = await org.addFamily('Main family');
    const mainGuardian = await org.make<Row>(`/families/${mainFamily.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Perera',
    });
    const mia = await org.addStudent(mainFamily.id, { firstName: 'Mia' });
    const albanyFamily = await org.addFamily('Albany family', { branchId: albany.id });
    const ari = await org.addStudent(albanyFamily.id, { firstName: 'Ari', lastName: 'Ngata' });
    await org.enrol(mia.id, mainClass.id);
    await org.enrol(mia.id, albanyClass.id);
    await org.enrol(ari.id, albanyClass.id);
    return {
      ...org,
      albany,
      teacher,
      mainClass,
      albanyClass,
      mainSession,
      albanySession,
      mainGuardian,
      mia,
      ari,
    };
  }
  const present = (studentId: string): Mark[] => [{ studentId, status: 'present' }];

  it('lets the owner read and mark every session', async () => {
    const t = await twoBranches();
    expect(await seen(t.api, t.mainSession)).toEqual(['Mia: -']);
    expect(await seen(t.api, t.albanySession)).toEqual(['Ari: -', 'Mia: -']);
    expect((await mark(t.api, t.albanySession, present(t.ari.id))).status).toBe(200);
  });

  it('refuses an accountant on both routes', async () => {
    const t = await twoBranches();
    const { as } = await t.member('accountant');
    const results = await Promise.all([
      as('GET', path(t.mainSession)),
      mark(as, t.mainSession, present(t.mia.id)),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403]);
    expect(await t.rowsOf(t.mainSession)).toEqual([]);
  });

  it('lets a teacher read and mark the classes they teach, and no others', async () => {
    const t = await twoBranches();
    const { as, userId } = t.teacher;
    // The teacher copied onto a session gives no reach: the class's teacher does.
    const covered = await t.addSession(t.albanyClass.id, {
      startTime: '18:00',
      teacherMembershipId: t.teacher.id,
    });

    expect(await seen(as, t.mainSession)).toEqual(['Mia: -']);
    const marked = await mark(as, t.mainSession, [{ studentId: t.mia.id, status: 'late' }]);
    expect(marked.status).toBe(200);
    expect(await seen(t.api, t.mainSession)).toEqual(['Mia: late']);
    expect((await t.lastAudit()).map((e) => [e.action, e.actorUserId])).toEqual([
      ['attendance.marked', userId],
    ]);

    const outside = await Promise.all([
      as('GET', path(t.albanySession)),
      mark(as, t.albanySession, present(t.mia.id)),
      as('GET', path(covered)),
      mark(as, covered, present(t.mia.id)),
    ]);
    expect(outside.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await t.rowsOf(t.albanySession)).toEqual([]);

    // Classes and sessions themselves stay read-only for a teacher.
    const write = await as('PUT', `/classes/${t.mainClass.id}/schedule`, { slots: [] });
    expect(write.status).toBe(403);
  });

  it('lets a parent read their own children’s attendance only, and mark nothing', async () => {
    const t = await twoBranches();
    const other = await t.addClass({ name: 'Other group' });
    const otherSession = await t.addSession(other.id);
    const parent = await t.member('parent');
    const stranger = await t.member('parent');
    // What accepting an invite will do: tie the guardian to the parent's membership.
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, t.mainGuardian.id));
    const { as } = parent;
    await mark(t.api, t.albanySession, [
      { studentId: t.mia.id, status: 'absent' },
      { studentId: t.ari.id, status: 'present' },
    ]);

    // The Albany session shows them their own child, not Ari.
    expect(await seen(as, t.albanySession)).toEqual(['Mia: absent']);
    expect(await seen(as, t.mainSession)).toEqual(['Mia: -']);
    expect((await as('GET', path(otherSession))).status).toBe(404);
    // A lesson of their child's class from before she joined: reachable, with nobody of theirs.
    const beforeMia = await t.addSession(t.albanyClass.id, { date: addDays(today(), -40) });
    expect(await seen(as, beforeMia)).toEqual([]);

    const write = await mark(as, t.mainSession, present(t.mia.id));
    expect(write.status).toBe(403);
    expect(await t.rowsOf(t.mainSession)).toEqual([]);

    // A parent who isn't tied to a guardian reaches no session.
    expect((await stranger.as('GET', path(t.mainSession))).status).toBe(404);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'keeps a %s limited to one branch to that branch’s sessions',
    async (role) => {
      const t = await twoBranches();
      const staff = await t.member(role, [t.albany.id]);
      const { as } = staff;

      // Their class's roster names Mia, whose family belongs to the Main branch, and they mark
      // her there. Her record stays out of their reach.
      expect(await seen(as, t.albanySession)).toEqual(['Ari: -', 'Mia: -']);
      const marked = await mark(as, t.albanySession, [
        { studentId: t.mia.id, status: 'excused' },
        { studentId: t.ari.id, status: 'present' },
      ]);
      expect(marked.status).toBe(200);
      expect(await seen(t.api, t.albanySession)).toEqual(['Ari: present', 'Mia: excused']);
      expect((await t.lastAudit()).map((e) => [e.action, e.actorUserId])).toEqual([
        ['attendance.marked', staff.userId],
      ]);
      expect((await as('GET', `/students/${t.mia.id}`)).status).toBe(404);

      const outside = await Promise.all([
        as('GET', path(t.mainSession)),
        mark(as, t.mainSession, present(t.mia.id)),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404]);
      expect(await t.rowsOf(t.mainSession)).toEqual([]);
    },
  );

  it('lets branch staff with no branch limit read and mark every session', async () => {
    const t = await twoBranches();
    const { as } = await t.member('front_desk');
    expect((await mark(as, t.mainSession, present(t.mia.id))).status).toBe(200);
    expect((await mark(as, t.albanySession, present(t.ari.id))).status).toBe(200);
    expect(await seen(as, t.albanySession)).toEqual(['Ari: present', 'Mia: -']);
  });

  it('shows staff limited to no branches nothing', async () => {
    const t = await twoBranches();
    const { as } = await t.member('branch_manager', []);
    const results = await Promise.all([
      as('GET', path(t.albanySession)),
      mark(as, t.albanySession, present(t.ari.id)),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404]);
  });
});

// A mark is answered from what the request read and what its write stored. The roster isn't
// read again (TUI-89), so these hold each answer to what the next read gives.
describe('what a mark answers with', () => {
  /** Marks, checks the answer is the roster the next read gives, and returns it as `seen` does. */
  const markAndRead = async (as: As, sessionId: string, records: Mark[]) => {
    const marked = await mark(as, sessionId, records);
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual((await as('GET', path(sessionId))).body);
    return (marked.body.records as AttendanceRecord[]).map(
      (r) => `${r.studentFirstName}: ${r.status ?? '-'}`,
    );
  };

  it('the roster as the next read gives it, as marks are set, changed, cleared and left alone', async () => {
    const { api, session, aroha, ben } = await classOfTwo();

    expect(
      await markAndRead(api, session, [
        { studentId: ben.id, status: 'present' },
        { studentId: aroha.id, status: 'late' },
      ]),
    ).toEqual(['Ben: present', 'Aroha: late']);
    expect(await markAndRead(api, session, [{ studentId: ben.id, status: 'excused' }])).toEqual([
      'Ben: excused',
      'Aroha: late',
    ]);
    // One cleared and one changed in the same request. Ben is still expected, so he stays.
    expect(
      await markAndRead(api, session, [
        { studentId: ben.id, status: null },
        { studentId: aroha.id, status: 'absent' },
      ]),
    ).toEqual(['Ben: -', 'Aroha: absent']);
    expect(await markAndRead(api, session, [{ studentId: aroha.id, status: 'absent' }])).toEqual([
      'Ben: -',
      'Aroha: absent',
    ]);
  });

  it('every mark of a class too big for one insert statement', async () => {
    const { api, addClass, addSession, newStudent, enrol, rowsOf } = await setup();
    const klass = await addClass();
    const session = await addSession(klass.id);
    // An insert holds 12 marks, so 13 students need two.
    const students: Student[] = [];
    for (let n = 1; n <= 13; n++) {
      const student = await newStudent(`Kid ${String(n).padStart(2, '0')}`, 'Perera');
      await enrol(student.id, klass.id);
      students.push(student);
    }
    const all = (status: Status): Mark[] => students.map(({ id }) => ({ studentId: id, status }));
    const names = students.map((student) => student.firstName);

    expect(await markAndRead(api, session, all('present'))).toEqual(
      names.map((name) => `${name}: present`),
    );
    // Every one of them again: each keeps its row.
    expect(await markAndRead(api, session, all('late'))).toEqual(
      names.map((name) => `${name}: late`),
    );
    expect(await rowsOf(session)).toHaveLength(13);
    // The first one cleared, with the other twelve changed.
    expect(
      await markAndRead(api, session, [
        { studentId: students[0]!.id, status: null },
        ...all('absent').slice(1),
      ]),
    ).toEqual(names.map((name, index) => `${name}: ${index === 0 ? '-' : 'absent'}`));
  });

  it('a student who was marked and has since withdrawn, by name, until their mark is cleared', async () => {
    const { api, org, klass, session, aroha } = await classOfTwo();
    await mark(api, session, [{ studentId: aroha.id, status: 'absent' }]);
    // What withdrawing her before the lesson does: the enrolment is no longer active, and ends
    // before the lesson's date (TUI-46). Here, the day before it started.
    await db()
      .update(enrolments)
      .set({ status: 'withdrawn', endDate: sql`date(${enrolments.startDate}, '-1 day')` })
      .where(
        and(
          eq(enrolments.orgId, org.id),
          eq(enrolments.studentId, aroha.id),
          eq(enrolments.classId, klass.id),
        ),
      );

    expect(await seen(api, session)).toEqual(['Ben: -', 'Aroha: absent']);
    expect(await markAndRead(api, session, [{ studentId: aroha.id, status: 'excused' }])).toEqual([
      'Ben: -',
      'Aroha: excused',
    ]);
    // Cleared, she is off the roster in the answer itself, and can't be marked again.
    expect(await markAndRead(api, session, [{ studentId: aroha.id, status: null }])).toEqual([
      'Ben: -',
    ]);
    expect((await mark(api, session, [{ studentId: aroha.id, status: 'present' }])).status).toBe(
      422,
    );
  });

  it('two people marking the same session at once, each with the marks they made', async () => {
    const { api, member, session, aroha, ben, rowsOf } = await classOfTwo();
    const { as } = await member('front_desk');

    const [first, second] = await Promise.all([
      mark(api, session, [
        { studentId: aroha.id, status: 'present' },
        { studentId: ben.id, status: 'present' },
      ]),
      mark(as, session, [{ studentId: aroha.id, status: 'late' }]),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const statusOf = (body: { records: AttendanceRecord[] }, studentId: string) =>
      body.records.find((record) => record.studentId === studentId)!.status;
    expect(statusOf(first.body, aroha.id)).toBe('present');
    expect(statusOf(first.body, ben.id)).toBe('present');
    expect(statusOf(second.body, aroha.id)).toBe('late');

    // One mark each, whichever of the two landed last.
    const rows = await rowsOf(session);
    expect(
      rows
        .filter((row) => row.deletedAt === null)
        .map((row) => row.studentId)
        .sort(),
    ).toEqual([aroha.id, ben.id].sort());
    expect(rows).toHaveLength(2);
  });
});
