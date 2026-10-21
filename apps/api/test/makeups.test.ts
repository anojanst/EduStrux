import { absenceNotices, guardians, makeupCredits, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Make-ups (TUI-55): the policy, credits earned by marks, and booking them into other lessons.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type Credit = {
  id: string;
  studentId: string;
  sessionId: string;
  missedOn: string;
  expiresOn: string | null;
  status: string;
  booking: { id: string; sessionId: string; className: string } | null;
};

const POLICY = {
  enabled: true,
  creditForExcused: true,
  creditForAbsent: false,
  requireNotice: false,
  expiryDays: 30,
  sameCourseOnly: true,
};

/**
 * Maths A and Maths B (one course) and English (another), each with lessons every Monday from
 * next Monday. Aroha and Ben are in Maths A, which had a lesson yesterday that can be marked.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
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
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const maths = await make('/subjects', { name: 'Mathematics' });
  const english = await make('/subjects', { name: 'English' });
  const mathsCourse = await make('/courses', { subjectId: maths.id, gradeLevelId: grade.id });
  const englishCourse = await make('/courses', { subjectId: english.id, gradeLevelId: grade.id });
  const start = addDays(today(), -14);
  const addClass = async (name: string, courseId: string, body: Record<string, unknown> = {}) => {
    const klass = await make('/classes', {
      courseId,
      branchId: main.id,
      name,
      startDate: start,
      ...body,
    });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    return klass;
  };
  const mathsA = await addClass('Maths A', mathsCourse.id);
  const mathsB = await addClass('Maths B', mathsCourse.id, { capacity: 1 });
  const englishClass = await addClass('English', englishCourse.id);

  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const mere = await make(`/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  const aroha = await make('/students', {
    familyId: family.id,
    firstName: 'Aroha',
    lastName: 'Perera',
  });
  const ben = await make('/students', {
    familyId: family.id,
    firstName: 'Ben',
    lastName: 'Perera',
  });
  await make('/enrolments', { studentId: aroha.id, classId: mathsA.id, startDate: start });
  await make('/enrolments', { studentId: ben.id, classId: mathsA.id, startDate: start });

  // Yesterday's Maths A lesson, written straight in: the generator only makes lessons to come.
  const missed = newId('session');
  await db()
    .insert(sessions)
    .values({
      id: missed,
      orgId: org.id,
      classId: mathsA.id,
      date: addDays(today(), -1),
      startTime: '16:00',
      endTime: '17:00',
    });
  const lessonsOf = async (classId: string) =>
    (
      await api(
        'GET',
        `/sessions?classId=${classId}&from=${nextMonday()}&to=${addDays(nextMonday(), 20)}`,
      )
    ).body.data as Row[];

  const setPolicy = (body: Partial<typeof POLICY> = {}) =>
    api('PUT', '/makeup-policy', { ...POLICY, ...body });
  const markMissed = (records: { studentId: string; status: string | null }[], as: As = api) =>
    as('PUT', `/sessions/${missed}/attendance`, { records });
  const credits = async (query = '', as: As = api) =>
    (await as('GET', `/makeup-credits${query}`)).body.data as Credit[];
  const book = (creditId: string, sessionId: string, as: As = api) =>
    as('POST', '/makeup-bookings', { creditId, sessionId });

  return {
    org,
    base,
    api,
    make,
    member,
    main,
    mathsA,
    mathsB,
    englishClass,
    family,
    mere,
    aroha,
    ben,
    missed,
    lessonsOf,
    setPolicy,
    markMissed,
    credits,
    book,
  };
}

describe('the make-up policy', () => {
  it('is off with defaults until the owner saves it', async () => {
    const { api, setPolicy, member } = await setup();
    expect((await api('GET', '/makeup-policy')).body).toEqual({
      enabled: false,
      creditForExcused: true,
      creditForAbsent: false,
      requireNotice: true,
      expiryDays: 60,
      sameCourseOnly: true,
      updatedAt: null,
    });
    const saved = await setPolicy();
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ...POLICY, updatedAt: expect.any(String) });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({ action: 'makeup_policy.updated', after: { enabled: true } });
    expect((await setPolicy({ expiryDays: 0 })).status).toBe(400);
    const desk = await member('front_desk');
    expect((await desk.as('GET', '/makeup-policy')).status).toBe(200);
    expect((await desk.as('PUT', '/makeup-policy', POLICY)).status).toBe(403);
  });
});

describe('make-up credits', () => {
  it('are earned by an excused mark under the policy, and taken back when the mark changes', async () => {
    const { setPolicy, markMissed, credits, aroha, ben, missed, api } = await setup();
    // Off: nothing is earned.
    await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    expect(await credits()).toEqual([]);

    await setPolicy();
    await markMissed([
      { studentId: aroha.id, status: 'present' },
      { studentId: ben.id, status: 'absent' },
    ]);
    expect(await credits()).toEqual([]);
    const marked = await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    expect(marked.status).toBe(200);
    const [credit] = await credits();
    expect(credit).toEqual({
      id: expect.stringMatching(/^mkc_/),
      studentId: aroha.id,
      studentFirstName: 'Aroha',
      studentLastName: 'Perera',
      sessionId: missed,
      classId: expect.any(String),
      courseId: expect.any(String),
      missedOn: addDays(today(), -1),
      expiresOn: addDays(today(), 29),
      status: 'available',
      booking: null,
      createdAt: expect.any(String),
    });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'attendance.marked',
      after: { creditsEarned: [aroha.id] },
    });

    // Marked excused again: still one credit.
    await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    expect(await credits()).toHaveLength(1);
    // Marked present: the unused credit is taken back.
    await markMissed([{ studentId: aroha.id, status: 'present' }]);
    expect(await credits()).toEqual([]);
    expect((await api('GET', '/audit-log?limit=1')).body.data[0].after).toMatchObject({
      creditsWithdrawn: [aroha.id],
    });
  });

  it('need a notice given before the lesson when the policy says so', async () => {
    const { setPolicy, markMissed, credits, aroha, ben, org } = await setup();
    await setPolicy({ requireNotice: true, creditForAbsent: true });
    // Aroha's notice was given two days ago; Ben's only now, after the lesson.
    await db()
      .insert(absenceNotices)
      .values({
        id: newId('absenceNotice'),
        orgId: org.id,
        studentId: aroha.id,
        startDate: addDays(today(), -1),
        endDate: addDays(today(), -1),
        source: 'parent',
        createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      });
    await db()
      .insert(absenceNotices)
      .values({
        id: newId('absenceNotice'),
        orgId: org.id,
        studentId: ben.id,
        startDate: addDays(today(), -1),
        endDate: addDays(today(), -1),
        source: 'staff',
      });
    await markMissed([
      { studentId: aroha.id, status: 'absent' },
      { studentId: ben.id, status: 'absent' },
    ]);
    expect((await credits()).map((c) => c.studentId)).toEqual([aroha.id]);
  });

  it('read as expired once past their last day, and filter by student and status', async () => {
    const { setPolicy, markMissed, credits, aroha, ben, org } = await setup();
    await setPolicy();
    await markMissed([
      { studentId: aroha.id, status: 'excused' },
      { studentId: ben.id, status: 'excused' },
    ]);
    await db()
      .update(makeupCredits)
      .set({ expiresOn: addDays(today(), -1) })
      .where(eq(makeupCredits.studentId, ben.id));
    expect((await credits(`?studentId=${aroha.id}`)).map((c) => c.status)).toEqual(['available']);
    expect((await credits('?status=expired')).map((c) => c.studentId)).toEqual([ben.id]);
    expect((await credits('?status=available')).map((c) => c.studentId)).toEqual([aroha.id]);
    expect((await credits()).map((c) => c.status).sort()).toEqual(['available', 'expired']);
    expect(org.id).toBeDefined();
  });

  it('are listed for the students the caller reaches', async () => {
    const { setPolicy, markMissed, credits, aroha, member, mere, api } = await setup();
    await setPolicy();
    await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    const parent = await member('parent');
    await db().update(guardians).set({ membershipId: parent.id }).where(eq(guardians.id, mere.id));
    expect((await credits('', parent.as)).map((c) => c.studentId)).toEqual([aroha.id]);
    const portal = await parent.as('GET', '/portal/makeup-credits');
    expect(portal.status).toBe(200);
    expect(portal.body.data).toHaveLength(1);
    expect((await api('GET', '/portal/makeup-credits')).status).toBe(403);

    const stranger = await member('parent');
    expect(await credits('', stranger.as)).toEqual([]);
    expect((await stranger.as('GET', `/makeup-credits?studentId=${aroha.id}`)).status).toBe(404);
    expect((await (await member('accountant')).as('GET', '/makeup-credits')).status).toBe(403);
  });
});

describe('make-up bookings', () => {
  it('books a credit into another lesson of the course, which puts the student on its roster', async () => {
    const { setPolicy, markMissed, credits, book, aroha, mathsB, lessonsOf, api } = await setup();
    await setPolicy();
    await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    const [credit] = await credits();
    const [lesson] = await lessonsOf(mathsB.id);
    const res = await book(credit!.id, lesson!.id);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^mkb_/),
      creditId: credit!.id,
      studentId: aroha.id,
      sessionId: lesson!.id,
      date: nextMonday(),
      startTime: '16:00',
      classId: mathsB.id,
      className: 'Maths B',
      createdAt: expect.any(String),
    });
    const [used] = await credits();
    expect(used).toMatchObject({
      status: 'used',
      booking: { id: res.body.id, sessionId: lesson!.id, className: 'Maths B' },
    });
    const roster = await api('GET', `/sessions/${lesson!.id}/attendance`);
    expect(roster.body.records.map((r: { studentId: string }) => r.studentId)).toEqual([aroha.id]);
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({ action: 'makeup.booked', entityId: res.body.id });

    // A used credit can't be booked again.
    const [second] = (await lessonsOf(mathsB.id)).slice(1);
    const again = await book(credit!.id, second!.id);
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toEqual({ creditId: ['Used'] });

    // Cancelled, the credit is free again.
    expect((await api('DELETE', `/makeup-bookings/${res.body.id}`)).status).toBe(204);
    expect((await credits())[0]).toMatchObject({ status: 'available', booking: null });
    expect((await api('DELETE', `/makeup-bookings/${res.body.id}`)).status).toBe(404);
    expect((await api('GET', '/audit-log?limit=1')).body.data[0].action).toBe('makeup.cancelled');
  });

  it('refuses another course, a full lesson, the student’s own class, or after the credit lapses', async () => {
    const {
      setPolicy,
      markMissed,
      credits,
      book,
      aroha,
      ben,
      mathsA,
      mathsB,
      englishClass,
      lessonsOf,
      make,
      family,
    } = await setup();
    await setPolicy({ expiryDays: 10 });
    await markMissed([
      { studentId: aroha.id, status: 'excused' },
      { studentId: ben.id, status: 'excused' },
    ]);
    const all = await credits();
    const arohas = all.find((c) => c.studentId === aroha.id)!;
    const bens = all.find((c) => c.studentId === ben.id)!;

    const [english] = await lessonsOf(englishClass.id);
    const other = await book(arohas.id, english!.id);
    expect(other.status).toBe(422);
    expect(other.body.error.fields).toEqual({ sessionId: ['Another course'] });

    const [own] = await lessonsOf(mathsA.id);
    const enrolled = await book(arohas.id, own!.id);
    expect(enrolled.status).toBe(422);
    expect(enrolled.body.error.fields).toEqual({ sessionId: ['Enrolled'] });

    // Maths B has one place: Sam fills it.
    const sam = await make('/students', {
      familyId: family.id,
      firstName: 'Sam',
      lastName: 'Perera',
    });
    await make('/enrolments', { studentId: sam.id, classId: mathsB.id });
    const [b] = await lessonsOf(mathsB.id);
    const full = await book(bens.id, b!.id);
    expect(full.status).toBe(422);
    expect(full.body.error.fields).toEqual({ sessionId: ['Full'] });

    // The credit lapses ten days after yesterday; Maths B's lessons two weeks on are too late.
    const late = (await lessonsOf(mathsA.id)).at(-1)!;
    const lapsed = await book(arohas.id, late.id);
    expect(lapsed.status).toBe(422);

    expect((await book('mkc_missing', b!.id)).status).toBe(404);
    expect((await book(arohas.id, 'ses_missing')).status).toBe(404);
  });

  it('is for staff who write classes; another org’s ids are 404', async () => {
    const { setPolicy, markMissed, credits, book, aroha, mathsB, lessonsOf, member, base } =
      await setup();
    await setPolicy();
    await markMissed([{ studentId: aroha.id, status: 'excused' }]);
    const [credit] = await credits();
    const [lesson] = await lessonsOf(mathsB.id);
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      expect((await book(credit!.id, lesson!.id, (await member(role)).as)).status).toBe(403);
    }
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('POST', `${base}/makeup-bookings`, {
      token: stranger.token,
      body: { creditId: credit!.id, sessionId: lesson!.id },
    });
    expect(res.status).toBe(404);
  });
});
