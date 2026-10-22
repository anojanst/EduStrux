import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Clash detection (TUI-50): lessons that overlap in one room, with one teacher, with a student in
// both, or two courses of one grade level at once.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));

type Row = { id: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
type Clash = {
  kind: string;
  date: string;
  sessions: { classId: string; className: string; startTime: string; endTime: string }[];
  roomId: string | null;
  teacherId: string | null;
  gradeLevelId: string | null;
  studentId: string | null;
  studentFirstName: string | null;
};

/**
 * Two branches. In Main, every Monday from next Monday on:
 * - Maths A, 16:00–17:00, room 1, teacher Tia; Aroha is enrolled.
 * - English A, 16:30–17:30, room 1, teacher Tia; Aroha is enrolled. Same grade, another course.
 * - Maths B, 17:00–18:00, room 1: touches Maths A's end, which isn't a clash.
 * In Albany, Science, 16:00–17:00, with Tia teaching too. Every course is Year 10.
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
  const albany = await make('/branches', { name: 'Albany' });
  const room = await make(`/branches/${main.id}/rooms`, { name: 'Room 1' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const maths = await make('/subjects', { name: 'Mathematics' });
  const english = await make('/subjects', { name: 'English' });
  const science = await make('/subjects', { name: 'Science' });
  const course = (subjectId: string) =>
    make('/courses', { subjectId, gradeLevelId: grade.id, durationMinutes: 60 });
  const mathsCourse = await course(maths.id);
  const englishCourse = await course(english.id);
  const scienceCourse = await course(science.id);
  const tia = await member('teacher');
  const start = nextMonday();
  const addClass = async (
    name: string,
    courseId: string,
    startTime: string,
    body: Record<string, unknown>,
  ) => {
    const klass = await make('/classes', {
      courseId,
      name,
      startDate: start,
      branchId: main.id,
      ...body,
    });
    const res = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime }],
    });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
    return klass;
  };
  const mathsA = await addClass('Maths A', mathsCourse.id, '16:00', {
    roomId: room.id,
    teacherId: tia.id,
  });
  const englishA = await addClass('English A', englishCourse.id, '16:30', {
    roomId: room.id,
    teacherId: tia.id,
  });
  const mathsB = await addClass('Maths B', mathsCourse.id, '17:00', { roomId: room.id });
  const scienceAlbany = await addClass('Science', scienceCourse.id, '16:00', {
    branchId: albany.id,
    teacherId: tia.id,
  });

  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const aroha = await make('/students', {
    familyId: family.id,
    firstName: 'Aroha',
    lastName: 'Perera',
  });
  await make('/enrolments', { studentId: aroha.id, classId: mathsA.id });
  await make('/enrolments', { studentId: aroha.id, classId: englishA.id });

  const clashes = async (as: As = api, query = `from=${start}&to=${start}`) => {
    const res = await as('GET', `/timetable/clashes?${query}`);
    return res;
  };
  return {
    org,
    base,
    api,
    member,
    main,
    albany,
    room,
    grade,
    tia,
    start,
    mathsA,
    englishA,
    mathsB,
    scienceAlbany,
    aroha,
    clashes,
  };
}

const kinds = (data: Clash[]) =>
  data.map((c) => `${c.kind}: ${c.sessions.map((s) => s.className).join(' + ')}`).sort();

describe('GET /timetable/clashes', () => {
  it('finds room, teacher, student and grade clashes, and nothing for lessons that only touch', async () => {
    const { clashes, start, room, tia, grade, aroha } = await setup();
    const res = await clashes();
    expect(res.status).toBe(200);
    expect(kinds(res.body.data)).toEqual([
      'grade: English A + Maths B',
      'grade: Maths A + English A',
      'grade: Maths A + Science',
      'grade: Science + English A',
      'room: English A + Maths B',
      'room: Maths A + English A',
      'student: Maths A + English A',
      'teacher: Maths A + English A',
      'teacher: Maths A + Science',
      'teacher: Science + English A',
    ]);
    const byKind = (kind: string) => (res.body.data as Clash[]).filter((c) => c.kind === kind);
    expect(byKind('room')[0]).toMatchObject({ date: start, roomId: room.id, teacherId: null });
    expect(byKind('teacher')[0]).toMatchObject({ teacherId: tia.id });
    expect(byKind('grade')[0]).toMatchObject({ gradeLevelId: grade.id });
    expect(byKind('student')[0]).toMatchObject({
      studentId: aroha.id,
      studentFirstName: 'Aroha',
      studentLastName: 'Perera',
    });
    expect(byKind('student')[0]!.sessions[0]).toEqual({
      id: expect.stringMatching(/^ses_/),
      classId: expect.any(String),
      className: 'Maths A',
      branchId: expect.any(String),
      startTime: '16:00',
      endTime: '17:00',
    });
  });

  it('checks every date in the range, and only those', async () => {
    const { clashes, start } = await setup();
    const twoWeeks = await clashes(undefined, `from=${start}&to=${addDays(start, 7)}`);
    expect(twoWeeks.body.data).toHaveLength(20);
    const before = await clashes(undefined, `from=${addDays(start, -7)}&to=${addDays(start, -1)}`);
    expect(before.body.data).toEqual([]);
  });

  it('keeps branch staff and teachers to what they reach, and filters by branch', async () => {
    const { clashes, member, main, albany, tia } = await setup();
    const desk = await member('front_desk', [main.id]);
    // The Albany lesson is out of reach, so Tia's clash with it isn't seen.
    expect(kinds((await clashes(desk.as)).body.data)).not.toContain('teacher: Maths A + Science');
    const filtered = await clashes(
      undefined,
      `from=${nextMonday()}&to=${nextMonday()}&branchId=${albany.id}`,
    );
    expect(filtered.body.data).toEqual([]);
    const teacher = await clashes(tia.as);
    expect(teacher.status).toBe(200);
    // Tia teaches Maths A, English A and Science, not Maths B.
    expect(kinds(teacher.body.data)).not.toContain('room: English A + Maths B');
    expect(kinds(teacher.body.data)).toContain('teacher: Maths A + Science');
  });

  it('refuses a range that is backwards, too long, or missing', async () => {
    const { clashes, start } = await setup();
    expect((await clashes(undefined, `from=${start}&to=${addDays(start, -1)}`)).status).toBe(400);
    const long = await clashes(undefined, `from=${start}&to=${addDays(start, 92)}`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toHaveProperty('to');
    expect((await clashes(undefined, `from=${start}&to=${addDays(start, 91)}`)).status).toBe(200);
    expect((await clashes(undefined, `from=${start}`)).status).toBe(400);
  });

  it('is 404 for a branch the org doesn’t have and for another org', async () => {
    const { clashes, start, base } = await setup();
    expect(
      (await clashes(undefined, `from=${start}&to=${start}&branchId=brn_missing`)).status,
    ).toBe(404);
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('GET', `${base}/timetable/clashes?from=${start}&to=${start}`, {
      token: stranger.token,
    });
    expect(res.status).toBe(404);
  });

  it('is 403 for a parent and an accountant', async () => {
    const { clashes, member } = await setup();
    for (const role of ['parent', 'accountant'] as const) {
      expect((await clashes((await member(role)).as)).status).toBe(403);
    }
  });

  it('reads in one stage after sign-in', async () => {
    const { clashes } = await setup();
    expect((await clashes()).db.stages).toBeLessThanOrEqual(2);
  });
});
