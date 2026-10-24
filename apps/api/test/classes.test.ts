import { memberships, sessions } from '@edustrux/db';
import {
  OPEN_ENDED_HORIZON_DAYS,
  addDays,
  eachDate,
  localNow,
  localToUtc,
  newId,
  weekday,
  type Role,
} from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));
/** One date a week: `weeks` of them, starting `offset` days after `start`. */
const weekly = (start: string, offset: number, weeks: number) =>
  Array.from({ length: weeks }, (_, k) => addDays(start, offset + 7 * k));

type Slot = { weekday: number; startTime: string; endTime?: string };
type Class = {
  id: string;
  courseId: string;
  gradeLevelId: string;
  termId: string | null;
  branchId: string;
  roomId: string | null;
  teacherId: string | null;
  name: string;
  capacity: number | null;
  startDate: string | null;
  endDate: string | null;
  schedule: Required<Slot>[];
  updatedAt: string;
};
type Session = {
  id: string;
  classId: string;
  className: string;
  courseId: string;
  branchId: string;
  roomId: string | null;
  teacherId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

const TUE = { weekday: 2, startTime: '16:00', endTime: '17:00' };
const THU = { weekday: 4, startTime: '16:00', endTime: '17:30' };
const FRI = { weekday: 5, startTime: '09:00', endTime: '10:00' };

/**
 * An owner with a fresh org that has what a class needs: a course (60-minute lessons), the Main
 * branch with a room, and a ten-week term starting next Monday.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  type Row = { id: string; updatedAt: string };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const room = await make<Row>(`/branches/${main.id}/rooms`, { name: 'Room 1' });
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
  const setSchedule = async (classId: string, slots: Slot[]) => {
    const res = await api('PUT', `/classes/${classId}/schedule`, { slots });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
    return res.body as {
      class: Class;
      sessions: { added: number; removed: number; kept: number; through: string | null };
    };
  };
  /** Every session in a wide window (or the given one), optionally one class's. */
  const sessionsOf = async (
    classId?: string,
    from = addDays(today(), -30),
    to = addDays(today(), 400),
  ) => {
    const res = await api(
      'GET',
      `/sessions?from=${from}&to=${to}&limit=200${classId ? `&classId=${classId}` : ''}`,
    );
    if (res.status !== 200) throw new Error(`sessions failed: ${JSON.stringify(res.body)}`);
    return res.body.data as Session[];
  };
  /** A member of the org with the given role, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as = (method: string, path: string, body?: unknown) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, userId: user.userId, as };
  };
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      id: string;
      action: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[];

  return {
    owner,
    org,
    base,
    api,
    make,
    main,
    room,
    subject,
    grade,
    course,
    year,
    term,
    start,
    end,
    addClass,
    setSchedule,
    sessionsOf,
    member,
    lastAudit,
  };
}

/** A session written straight to the database, for states the API can't produce yet. */
async function insertSession(
  orgId: string,
  classId: string,
  values: { date: string; startTime: string; endTime: string; status?: 'scheduled' | 'cancelled' },
) {
  const id = newId('session');
  await db()
    .insert(sessions)
    .values({ id, orgId, classId, ...values });
  return id;
}

describe('classes', () => {
  it('adds a class in a term, reads, lists, updates and deletes it, with audit rows', async () => {
    const { api, course, grade, term, main, room, member, lastAudit } = await setup();
    const teacher = await member('teacher');

    const created = await api('POST', '/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      roomId: room.id,
      teacherId: teacher.id,
      name: 'Group A',
      capacity: 12,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^cls_/),
      courseId: course.id,
      gradeLevelId: grade.id,
      termId: term.id,
      branchId: main.id,
      roomId: room.id,
      teacherId: teacher.id,
      name: 'Group A',
      capacity: 12,
      startDate: null,
      endDate: null,
      schedule: [],
    });
    for (const hidden of ['orgId', 'deletedAt', 'teacherMembershipId']) {
      expect(created.body).not.toHaveProperty(hidden);
    }
    const id = created.body.id as string;

    expect((await api('GET', `/classes/${id}`)).body).toEqual(created.body);
    expect((await api('GET', '/classes')).body).toEqual({ data: [created.body], nextCursor: null });

    const updated = await api('PATCH', `/classes/${id}`, {
      updatedAt: created.body.updatedAt,
      name: 'Group B',
      capacity: 8,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Group B', capacity: 8, roomId: room.id });

    expect((await api('DELETE', `/classes/${id}`)).status).toBe(204);
    expect((await api('GET', `/classes/${id}`)).status).toBe(404);
    expect((await api('GET', '/classes')).body.data).toEqual([]);

    const audit = await lastAudit(3);
    expect(audit.map((e) => e.action)).toEqual(['class.deleted', 'class.updated', 'class.created']);
    expect(audit[1]).toMatchObject({
      entityId: id,
      before: { name: 'Group A', capacity: 12 },
      after: { name: 'Group B', capacity: 8 },
    });
  });

  it('adds an open-ended class, which needs a start date instead of a term', async () => {
    const { api, course, main } = await setup();
    const body = { courseId: course.id, branchId: main.id, name: 'Rolling' };

    const noStart = await api('POST', '/classes', body);
    expect(noStart.status).toBe(400);
    expect(noStart.body.error.fields).toEqual({
      startDate: ['Required when the class has no term'],
    });

    const created = await api('POST', '/classes', { ...body, startDate: today() });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ termId: null, startDate: today(), endDate: null });

    // And it can't lose that start date later.
    const cleared = await api('PATCH', `/classes/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      startDate: null,
    });
    expect(cleared.status).toBe(400);
    expect(Object.keys(cleared.body.error.fields)).toEqual(['startDate']);
  });

  const ids = { courseId: 'crs_x', branchId: 'brn_x', name: 'Group A', termId: 'trm_x' };
  it.each<[Record<string, unknown>, string[]]>([
    [{ termId: 'trm_x' }, ['courseId', 'branchId', 'name']],
    [{ ...ids, name: '  ' }, ['name']],
    [{ ...ids, capacity: 0 }, ['capacity']],
    [{ ...ids, capacity: 2.5 }, ['capacity']],
    [{ ...ids, startDate: '2027-02-30' }, ['startDate']],
    [{ ...ids, startDate: '2027-03-10', endDate: '2027-03-09' }, ['endDate']],
  ])('rejects an invalid class %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/classes', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
  });

  it('returns 404 for a course, term, branch, room or teacher the org does not have', async () => {
    const { api, course, term, main } = await setup();
    const other = await setup();
    const othersTeacher = await other.member('teacher');
    const good = { courseId: course.id, termId: term.id, branchId: main.id, name: 'Group A' };

    const results = await Promise.all([
      api('POST', '/classes', { ...good, courseId: other.course.id }),
      api('POST', '/classes', { ...good, termId: other.term.id }),
      api('POST', '/classes', { ...good, branchId: other.main.id }),
      api('POST', '/classes', { ...good, roomId: other.room.id }),
      api('POST', '/classes', { ...good, teacherId: othersTeacher.id }),
      api('POST', '/classes', { ...good, courseId: 'crs_nope' }),
      api('POST', '/classes', { ...good, teacherId: 'mem_nope' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect((await api('GET', '/classes')).body.data).toEqual([]);
  });

  it('refuses a room in another branch, a parent as teacher and dates outside the term', async () => {
    const { api, make, addClass, member, start, end } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const albanyRoom = await make<{ id: string }>(`/branches/${albany.id}/rooms`, { name: 'A1' });
    const parent = await member('parent');
    const klass = await addClass();
    const post = (body: Record<string, unknown>) =>
      api('POST', '/classes', {
        courseId: klass.courseId,
        termId: klass.termId,
        branchId: klass.branchId,
        name: 'Group B',
        ...body,
      });

    const wrongRoom = await post({ roomId: albanyRoom.id });
    expect(wrongRoom.status).toBe(422);
    expect(wrongRoom.body.error.fields).toEqual({ roomId: ['In another branch'] });

    const parentTeacher = await post({ teacherId: parent.id });
    expect(parentTeacher.status).toBe(422);
    expect(parentTeacher.body.error.fields).toEqual({ teacherId: ['Not active staff'] });

    const early = await post({ startDate: addDays(start, -1) });
    expect(early.status).toBe(422);
    expect(early.body.error.fields).toEqual({ startDate: ['Outside the term'] });
    const late = await post({ endDate: addDays(end, 1) });
    expect(late.status).toBe(422);
    expect(late.body.error.fields).toEqual({ endDate: ['Outside the term'] });
    expect((await post({ startDate: start, endDate: end })).status).toBe(201);

    // The same rules on PATCH.
    const patch = (body: Record<string, unknown>) =>
      api('PATCH', `/classes/${klass.id}`, { updatedAt: klass.updatedAt, ...body });
    expect((await patch({ roomId: albanyRoom.id })).status).toBe(422);
    expect((await patch({ teacherId: parent.id })).status).toBe(422);
    expect((await patch({ endDate: addDays(end, 1) })).status).toBe(422);
    const backwards = await patch({ startDate: addDays(start, 7), endDate: start });
    expect(backwards.status).toBe(400);
    expect(Object.keys(backwards.body.error.fields)).toEqual(['endDate']);
  });

  it('lets any active staff member teach, the owner included', async () => {
    const { owner, org, api, addClass, member } = await setup();
    const me = await call('GET', '/api/v1/me', { token: owner.token });
    const ownerMembership = me.body.memberships.find(
      (m: { org: { id: string } }) => m.org.id === org.id,
    );
    const frontDesk = await member('front_desk');

    expect((await addClass({ name: 'Mine', teacherId: ownerMembership.id })).teacherId).toBe(
      ownerMembership.id,
    );
    expect((await addClass({ name: 'Theirs', teacherId: frontDesk.id })).teacherId).toBe(
      frontDesk.id,
    );
    expect((await api('GET', `/classes?teacherId=${frontDesk.id}`)).body.data).toHaveLength(1);
  });

  it('keeps names unique among a course’s classes in the same term and branch', async () => {
    const { api, make, addClass, subject, grade, year, start, end } = await setup();
    const groupA = await addClass({ name: 'Group A' });

    const dup = await api('POST', '/classes', {
      courseId: groupA.courseId,
      termId: groupA.termId,
      branchId: groupA.branchId,
      name: 'group a',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'conflict', fields: { name: ['Taken'] } });

    // The same name is fine in another branch, another term, with no term, or for another course.
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const term2 = await make<{ id: string }>('/terms', {
      academicYearId: year.id,
      name: 'Term 2',
      startDate: addDays(end, 1),
      endDate: addDays(end, 60),
    });
    const course2 = await make<{ id: string }>('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      curriculum: 'Cambridge',
    });
    await addClass({ branchId: albany.id });
    await addClass({ termId: term2.id });
    await addClass({ termId: null, startDate: start });
    await addClass({ courseId: course2.id });
    // Two open-ended classes of the same course and branch do clash.
    const openDup = await api('POST', '/classes', {
      courseId: groupA.courseId,
      branchId: groupA.branchId,
      name: 'GROUP A',
      startDate: start,
    });
    expect(openDup.status).toBe(409);

    const groupB = await addClass({ name: 'Group B' });
    const rename = await api('PATCH', `/classes/${groupB.id}`, {
      updatedAt: groupB.updatedAt,
      name: 'Group A',
    });
    expect(rename.status).toBe(409);

    await api('DELETE', `/classes/${groupA.id}`);
    expect((await addClass({ name: 'Group A' })).name).toBe('Group A');
  });

  it('keeps a class’s course, term and branch: a PATCH can’t move it', async () => {
    const { api, make, addClass } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const klass = await addClass();

    const res = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      courseId: 'crs_other',
      termId: null,
      branchId: albany.id,
      capacity: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      courseId: klass.courseId,
      termId: klass.termId,
      branchId: klass.branchId,
      capacity: 5,
    });
  });

  it('clears the room, teacher and capacity with null', async () => {
    const { api, addClass, room, member } = await setup();
    const teacher = await member('teacher');
    const klass = await addClass({ roomId: room.id, teacherId: teacher.id, capacity: 10 });
    const res = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      roomId: null,
      teacherId: null,
      capacity: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ roomId: null, teacherId: null, capacity: null });
  });

  it('returns 409 for a stale updatedAt, 400 without one, and the class when nothing changes', async () => {
    const { api, addClass } = await setup();
    const klass = await addClass();

    const same = await api('PATCH', `/classes/${klass.id}`, { updatedAt: klass.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(klass);

    const missing = await api('PATCH', `/classes/${klass.id}`, { capacity: 5 });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.error.fields)).toEqual(['updatedAt']);

    await api('PATCH', `/classes/${klass.id}`, { updatedAt: klass.updatedAt, capacity: 5 });
    const stale = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      capacity: 6,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('filters by branch, term, course, grade level and teacher, and pages with a cursor', async () => {
    const { api, make, addClass, subject, main, term, course, grade, start, member } =
      await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const year9 = await make<{ id: string }>('/grade-levels', { name: 'Year 9' });
    const course9 = await make<{ id: string }>('/courses', {
      subjectId: subject.id,
      gradeLevelId: year9.id,
    });
    const teacher = await member('teacher');
    const a = await addClass({ name: 'A', teacherId: teacher.id });
    const b = await addClass({ name: 'B', branchId: albany.id });
    const c = await addClass({ name: 'C', courseId: course9.id });
    const d = await addClass({ name: 'D', termId: null, startDate: start });
    const names = async (query: string) =>
      (await api('GET', `/classes${query}`)).body.data.map((k: Class) => k.name) as string[];

    expect(await names('')).toEqual(['A', 'B', 'C', 'D']);
    expect(await names(`?branchId=${albany.id}`)).toEqual(['B']);
    expect(await names(`?branchId=${main.id}`)).toEqual(['A', 'C', 'D']);
    expect(await names(`?termId=${term.id}`)).toEqual(['A', 'B', 'C']);
    expect(await names(`?courseId=${course.id}`)).toEqual(['A', 'B', 'D']);
    expect(await names(`?gradeLevelId=${year9.id}`)).toEqual(['C']);
    expect(await names(`?gradeLevelId=${grade.id}&branchId=${main.id}`)).toEqual(['A', 'D']);
    expect(await names(`?teacherId=${teacher.id}`)).toEqual(['A']);
    expect([a.id, b.id, c.id, d.id]).toHaveLength(4);

    const first = await api('GET', '/classes?limit=3');
    expect(first.body.data.map((k: Class) => k.name)).toEqual(['A', 'B', 'C']);
    expect(await names(`?limit=3&cursor=${first.body.nextCursor}`)).toEqual(['D']);

    const unknown = await Promise.all(
      ['branchId=brn_x', 'termId=trm_x', 'courseId=crs_x', 'gradeLevelId=grd_x', 'teacherId=mem_x']
        .map((q) => api('GET', `/classes?${q}`))
        .concat(api('GET', '/classes?limit=0')),
    );
    expect(unknown.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 400]);
  });

  it('gives each class on a page its own weekly slots, on a later page and through a filter too', async () => {
    const { api, addClass, setSchedule, member } = await setup();
    const teacher = await member('teacher');
    const a = await addClass({ name: 'A' });
    const b = await addClass({ name: 'B', teacherId: teacher.id });
    const c = await addClass({ name: 'C', teacherId: teacher.id });
    await setSchedule(a.id, [TUE]);
    await setSchedule(b.id, [THU, TUE]);
    await setSchedule(c.id, [FRI]);
    const slots = (res: { body: { data: Class[] } }) =>
      res.body.data.map((k) => [k.name, k.schedule]);

    const first = await api('GET', '/classes?limit=2');
    expect(slots(first)).toEqual([
      ['A', [TUE]],
      ['B', [TUE, THU]],
    ]);
    const second = await api('GET', `/classes?limit=2&cursor=${first.body.nextCursor}`);
    expect(slots(second)).toEqual([['C', [FRI]]]);
    expect(slots(await api('GET', `/classes?teacherId=${teacher.id}&limit=1`))).toEqual([
      ['B', [TUE, THU]],
    ]);
    expect(slots(await teacher.as('GET', '/classes'))).toEqual([
      ['B', [TUE, THU]],
      ['C', [FRI]],
    ]);
  });

  it('answers each write with the class as it is then stored', async () => {
    const { api, addClass, setSchedule, room, member, end } = await setup();
    const teacher = await member('teacher');
    const created = await addClass();
    const stored = async () => (await api('GET', `/classes/${created.id}`)).body as Class;
    expect(await stored()).toEqual(created);

    const scheduled = await setSchedule(created.id, [THU, TUE]);
    expect(scheduled.class).toEqual({ ...created, schedule: [TUE, THU] });
    expect(await stored()).toEqual(scheduled.class);
    // The same slots again write nothing, and the answer is still the class.
    expect((await setSchedule(created.id, [TUE, THU])).class).toEqual(scheduled.class);

    // A change that also restaffs and moves the class's sessions.
    const updated = await api('PATCH', `/classes/${created.id}`, {
      updatedAt: created.updatedAt,
      name: 'Group B',
      roomId: room.id,
      teacherId: teacher.id,
      endDate: addDays(end, -14),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Group B',
      roomId: room.id,
      teacherId: teacher.id,
      endDate: addDays(end, -14),
      schedule: [TUE, THU],
    });
    expect(await stored()).toEqual(updated.body);
  });

  it('reports the same check as before when several would fail', async () => {
    const { api, addClass, member, course, term, main, start, end } = await setup();
    await addClass(); // Group A, the name the last checks find taken
    const other = await addClass({ name: 'Group B' });
    const range = `from=${start}&to=${end}`;
    const answer = async (as: typeof api, method: string, path: string, body?: unknown) => {
      const res = await as(method, path, body);
      return `${res.status} ${res.body.error.message}`;
    };
    const early = addDays(start, -1); // before the term starts

    // Adding: the course, the term, the branch, the caller's branches, the room, the teacher, the
    // dates, then the name.
    const good = { courseId: course.id, termId: term.id, branchId: main.id, name: 'Group A' };
    const add = (body: Record<string, unknown>, as = api) =>
      answer(as, 'POST', '/classes', { ...good, ...body });
    expect(await add({ courseId: 'crs_x', termId: 'trm_x' })).toBe('404 Course not found');
    expect(await add({ termId: 'trm_x', branchId: 'brn_x' })).toBe('404 Term not found');
    expect(await add({ branchId: 'brn_x', roomId: 'rom_x' })).toBe('404 Branch not found');
    const nowhere = await member('front_desk', []);
    expect(await add({ roomId: 'rom_x' }, nowhere.as)).toMatch(/^403 /);
    expect(await add({ roomId: 'rom_x', teacherId: 'mem_x' })).toBe('404 Room not found');
    expect(await add({ teacherId: 'mem_x', startDate: early })).toBe('404 Teacher not found');
    expect(await add({ startDate: early })).toMatch(/^422 A class's dates must fall inside/);
    expect(await add({})).toMatch(/^409 This course already has a class with that name/);

    // Changing: the class, its updatedAt, the room, the teacher, the dates, then the name.
    const change = (body: Record<string, unknown>, id = other.id) =>
      answer(api, 'PATCH', `/classes/${id}`, { updatedAt: other.updatedAt, ...body });
    expect(await change({ roomId: 'rom_x' }, 'cls_x')).toBe('404 Class not found');
    const longAgo = '2020-01-01T00:00:00.000Z';
    expect(await change({ updatedAt: longAgo, roomId: 'rom_x' })).toMatch(/^409 This record was/);
    expect(await change({ roomId: 'rom_x', teacherId: 'mem_x' })).toBe('404 Room not found');
    expect(await change({ teacherId: 'mem_x', startDate: early })).toBe('404 Teacher not found');
    expect(await change({ startDate: early, name: 'group a' })).toMatch(/^422 A class's dates/);
    expect(await change({ name: 'group a' })).toMatch(/^409 This course already has a class/);
    expect((await api('GET', `/classes/${other.id}`)).body).toEqual(other);

    // Filters: each list checks its ids in the order the route lists them.
    const list = (query: string) => answer(api, 'GET', query);
    expect(await list('/classes?branchId=brn_x&termId=trm_x')).toBe('404 Branch not found');
    expect(await list('/classes?termId=trm_x&courseId=crs_x')).toBe('404 Term not found');
    expect(await list('/classes?courseId=crs_x&gradeLevelId=grd_x')).toBe('404 Course not found');
    expect(await list('/classes?gradeLevelId=grd_x&teacherId=mem_x')).toBe(
      '404 Grade level not found',
    );
    expect(await list(`/sessions?${range}&branchId=brn_x&roomId=rom_x`)).toBe(
      '404 Branch not found',
    );
    expect(await list(`/sessions?${range}&roomId=rom_x&gradeLevelId=grd_x`)).toBe(
      '404 Room not found',
    );
    expect(await list(`/sessions?${range}&gradeLevelId=grd_x&classId=cls_x`)).toBe(
      '404 Grade level not found',
    );
    expect(await list(`/sessions?${range}&classId=cls_x&teacherId=mem_x`)).toBe(
      '404 Class not found',
    );
    expect(await list(`/sessions?${range}&teacherId=mem_x&studentId=stu_x`)).toBe(
      '404 Teacher not found',
    );
    expect(await list(`/sessions?${range}&studentId=stu_x`)).toBe('404 Student not found');
  });
});

describe('weekly schedule and session generation', () => {
  it('generates the term’s sessions from the weekly slots, with one audit row', async () => {
    const { api, addClass, sessionsOf, lastAudit, room, member, main, start, end } = await setup();
    const teacher = await member('teacher');
    const klass = await addClass({ roomId: room.id, teacherId: teacher.id });

    // Sent out of order: the schedule comes back in weekday order.
    const res = await api('PUT', `/classes/${klass.id}/schedule`, { slots: [THU, TUE] });
    expect(res.status).toBe(200);
    expect(res.body.class).toMatchObject({ id: klass.id, schedule: [TUE, THU] });
    expect(res.body.sessions).toEqual({ added: 20, removed: 0, kept: 0, through: end });
    expect((await api('GET', `/classes/${klass.id}`)).body.schedule).toEqual([TUE, THU]);

    const list = await sessionsOf(klass.id);
    const tuesdays = weekly(start, 1, 10);
    const thursdays = weekly(start, 3, 10);
    expect(
      list.filter((s) => s.startTime === '16:00' && s.endTime === '17:00').map((s) => s.date),
    ).toEqual(tuesdays);
    expect(list.filter((s) => s.endTime === '17:30').map((s) => s.date)).toEqual(thursdays);
    expect(list.map((s) => s.date)).toEqual([...tuesdays, ...thursdays].sort());
    expect(list[0]).toEqual({
      id: expect.stringMatching(/^ses_/),
      classId: klass.id,
      className: 'Group A',
      courseId: klass.courseId,
      branchId: main.id,
      roomId: room.id,
      roomName: 'Room 1',
      teacherId: teacher.id,
      // The teacher has no name set, so their email stands in.
      teacherName: 'teacher@example.com',
      date: tuesdays[0],
      startTime: '16:00',
      endTime: '17:00',
      startsAt: localToUtc(tuesdays[0]!, '16:00', TZ),
      endsAt: localToUtc(tuesdays[0]!, '17:00', TZ),
      status: 'scheduled',
      movedFrom: null,
      attendance: { present: 0, late: 0, absent: 0, excused: 0 },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await api('GET', `/sessions/${list[0]!.id}`)).body).toEqual(list[0]);

    // One audit row for the whole change, not one per session.
    const audit = await lastAudit(2);
    expect(audit.map((e) => e.action)).toEqual(['class.schedule_set', 'class.created']);
    expect(audit[0]).toMatchObject({
      entityId: klass.id,
      before: { slots: [] },
      after: { slots: [TUE, THU], sessionsAdded: 20, sessionsRemoved: 0 },
    });
  });

  it('uses the course’s lesson length when a slot has no end time', async () => {
    const { api, make, addClass, setSchedule, subject, grade } = await setup();
    const klass = await addClass(); // the course has 60-minute lessons
    const result = await setSchedule(klass.id, [{ weekday: 2, startTime: '16:15' }]);
    expect(result.class.schedule).toEqual([{ weekday: 2, startTime: '16:15', endTime: '17:15' }]);

    const pastMidnight = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [TUE, { weekday: 3, startTime: '23:30' }],
    });
    expect(pastMidnight.status).toBe(400);
    expect(pastMidnight.body.error.fields).toEqual({ 'slots.1.endTime': ['Runs past midnight'] });

    const untimed = await make<{ id: string }>('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      curriculum: 'No duration',
    });
    const other = await addClass({ courseId: untimed.id });
    const noLength = await api('PUT', `/classes/${other.id}/schedule`, {
      slots: [{ weekday: 2, startTime: '16:00' }],
    });
    expect(noLength.status).toBe(400);
    expect(noLength.body.error.fields).toEqual({
      'slots.0.endTime': ['Required: the course has no durationMinutes'],
    });
  });

  it.each<[unknown, string[]]>([
    [{}, ['slots']],
    [{ slots: 'tuesday' }, ['slots']],
    [{ slots: [{ ...TUE, weekday: 0 }] }, ['slots.0.weekday']],
    [{ slots: [{ ...TUE, weekday: 8 }] }, ['slots.0.weekday']],
    [{ slots: [{ ...TUE, startTime: '4pm' }] }, ['slots.0.startTime']],
    [{ slots: [{ ...TUE, endTime: '16:00' }] }, ['slots.0.endTime']],
    [{ slots: [{ ...TUE, endTime: '15:00' }] }, ['slots.0.endTime']],
    [{ slots: [TUE, { weekday: 2, startTime: '16:30', endTime: '17:30' }] }, ['slots.1']],
    [{ slots: [{ weekday: 2, startTime: '16:30', endTime: '17:30' }, TUE] }, ['slots.0']],
    [{ slots: [TUE, TUE] }, ['slots.1']],
    [
      { slots: Array.from({ length: 15 }, (_, i) => ({ ...TUE, weekday: (i % 7) + 1 })) },
      ['slots'],
    ],
  ])('rejects an invalid schedule %j with 400', async (body, fields) => {
    const { api, addClass, sessionsOf } = await setup();
    const klass = await addClass();
    const res = await api('PUT', `/classes/${klass.id}/schedule`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields)).toEqual(fields);
    expect(await sessionsOf(klass.id)).toEqual([]);
  });

  it('allows back-to-back slots on the same day', async () => {
    const { addClass, setSchedule } = await setup();
    const klass = await addClass();
    const result = await setSchedule(klass.id, [
      TUE,
      { weekday: 2, startTime: '17:00', endTime: '18:00' },
    ]);
    expect(result.sessions.added).toBe(20);
  });

  it('skips dates closed by an organisation-wide holiday or one for the class’s branch', async () => {
    const { make, addClass, setSchedule, sessionsOf, main, start } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const tuesdays = weekly(start, 1, 10);
    await make('/holidays', {
      name: 'Public holiday',
      startDate: tuesdays[1],
      endDate: tuesdays[1],
    });
    await make('/holidays', {
      name: 'Main closed for a week',
      startDate: addDays(start, 21),
      endDate: addDays(start, 27),
      branchId: main.id,
    });
    await make('/holidays', {
      name: 'Albany only',
      startDate: tuesdays[5],
      endDate: tuesdays[5],
      branchId: albany.id,
    });
    const klass = await addClass();

    const result = await setSchedule(klass.id, [TUE]);
    expect(result.sessions.added).toBe(8);
    expect((await sessionsOf(klass.id)).map((s) => s.date)).toEqual(
      tuesdays.filter((_, week) => week !== 1 && week !== 3),
    );
  });

  it('changes nothing, and writes no audit row, when the same schedule is saved again', async () => {
    const { addClass, setSchedule, sessionsOf, lastAudit } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE, THU]);
    const before = await sessionsOf(klass.id);
    const [auditBefore] = await lastAudit();

    const again = await setSchedule(klass.id, [THU, TUE]);
    expect(again.sessions).toMatchObject({ added: 0, removed: 0, kept: 20 });
    expect(await sessionsOf(klass.id)).toEqual(before);
    expect((await lastAudit())[0]!.id).toBe(auditBefore!.id);
  });

  it('keeps the sessions that still match when the schedule changes', async () => {
    const { addClass, setSchedule, sessionsOf, lastAudit, start } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE, THU]);
    const tuesdayIds = (await sessionsOf(klass.id))
      .filter((s) => weekday(s.date) === 2)
      .map((s) => s.id);

    const result = await setSchedule(klass.id, [TUE, FRI]);
    expect(result.sessions).toMatchObject({ added: 10, removed: 10, kept: 10 });
    const after = await sessionsOf(klass.id);
    expect(after.filter((s) => weekday(s.date) === 2).map((s) => s.id)).toEqual(tuesdayIds);
    expect(after.filter((s) => weekday(s.date) === 4)).toEqual([]);
    expect(after.filter((s) => weekday(s.date) === 5).map((s) => s.date)).toEqual(
      weekly(start, 4, 10),
    );
    expect((await lastAudit())[0]).toMatchObject({
      action: 'class.schedule_set',
      before: { slots: [TUE, THU] },
      after: { slots: [TUE, FRI], sessionsAdded: 10, sessionsRemoved: 10 },
    });
  });

  it('replaces a session whose end time changed', async () => {
    const { addClass, setSchedule, sessionsOf } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE]);
    const oldIds = (await sessionsOf(klass.id)).map((s) => s.id);

    const result = await setSchedule(klass.id, [{ ...TUE, endTime: '17:30' }]);
    expect(result.sessions).toMatchObject({ added: 10, removed: 10, kept: 0 });
    const after = await sessionsOf(klass.id);
    expect(after.map((s) => s.endTime)).toEqual(Array(10).fill('17:30'));
    expect(after.some((s) => oldIds.includes(s.id))).toBe(false);
  });

  it('clears the upcoming sessions when the schedule is emptied', async () => {
    const { addClass, setSchedule, sessionsOf } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE, THU]);

    const result = await setSchedule(klass.id, []);
    expect(result.class.schedule).toEqual([]);
    expect(result.sessions).toMatchObject({ added: 0, removed: 20, kept: 0 });
    expect(await sessionsOf(klass.id)).toEqual([]);
  });

  it('never changes a session that has started, or one that is no longer just scheduled', async () => {
    const { org, addClass, setSchedule, sessionsOf, start } = await setup();
    const klass = await addClass();
    const yesterday = await insertSession(org.id, klass.id, {
      date: addDays(today(), -1),
      startTime: '16:00',
      endTime: '17:00',
    });
    const thisMorning = await insertSession(org.id, klass.id, {
      date: today(),
      startTime: '00:00',
      endTime: '00:30',
    });
    // A cancelled lesson on the first Tuesday, and one at a time the schedule won't have.
    const cancelledTuesday = await insertSession(org.id, klass.id, {
      date: addDays(start, 1),
      startTime: TUE.startTime,
      endTime: TUE.endTime,
      status: 'cancelled',
    });
    const cancelledOther = await insertSession(org.id, klass.id, {
      date: addDays(start, 2),
      startTime: '11:00',
      endTime: '12:00',
      status: 'cancelled',
    });

    // The cancelled Tuesday keeps its place: no second session is made for it.
    const result = await setSchedule(klass.id, [TUE]);
    expect(result.sessions).toMatchObject({ added: 9, removed: 0, kept: 0 });

    await setSchedule(klass.id, [FRI]);
    const after = await sessionsOf(klass.id);
    for (const id of [yesterday, thisMorning, cancelledTuesday, cancelledOther]) {
      expect(after.map((s) => s.id)).toContain(id);
    }
    expect(after.filter((s) => s.status === 'scheduled' && s.date > today())).toHaveLength(10);
    expect(after.find((s) => s.id === cancelledTuesday)!.status).toBe('cancelled');
  });

  it('only generates from now on when the term has already started', async () => {
    const { api, make, addClass, setSchedule, sessionsOf, year, term, course } = await setup();
    // Terms can't overlap, so the one that starts next Monday makes way.
    await api('DELETE', `/terms/${term.id}`);
    const running = await make<{ id: string }>('/terms', {
      academicYearId: year.id,
      name: 'Already running',
      startDate: addDays(today(), -14),
      endDate: addDays(today(), 6),
    });
    const klass = await addClass({ termId: running.id, courseId: course.id });

    // A lesson at midnight every day: today's has already started.
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      weekday: day,
      startTime: '00:00',
      endTime: '01:00',
    }));
    const result = await setSchedule(klass.id, everyDay);
    expect(result.sessions).toMatchObject({ added: 6, through: addDays(today(), 6) });
    expect((await sessionsOf(klass.id)).map((s) => s.date)).toEqual(
      eachDate(addDays(today(), 1), addDays(today(), 6)),
    );
  });

  it('narrows a term class to its own start and end dates', async () => {
    const { addClass, setSchedule, sessionsOf, start } = await setup();
    const klass = await addClass({ startDate: addDays(start, 14), endDate: addDays(start, 34) });
    const result = await setSchedule(klass.id, [TUE]);
    expect(result.sessions).toMatchObject({ added: 3, through: addDays(start, 34) });
    expect((await sessionsOf(klass.id)).map((s) => s.date)).toEqual(weekly(start, 15, 3));
  });

  it(`generates an open-ended class ${OPEN_ENDED_HORIZON_DAYS} days ahead`, async () => {
    const { addClass, setSchedule, sessionsOf } = await setup();
    const horizon = addDays(today(), OPEN_ENDED_HORIZON_DAYS);
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      weekday: day,
      startTime: '00:00',
      endTime: '01:00',
    }));

    const rolling = await addClass({ name: 'Rolling', termId: null, startDate: today() });
    const result = await setSchedule(rolling.id, everyDay);
    expect(result.sessions).toMatchObject({ added: OPEN_ENDED_HORIZON_DAYS, through: horizon });
    const dates = (await sessionsOf(rolling.id)).map((s) => s.date);
    expect(dates).toEqual(eachDate(addDays(today(), 1), horizon));

    // An end date inside the horizon stops it early; a later start date delays it.
    const ending = await addClass({
      name: 'Ending',
      termId: null,
      startDate: addDays(today(), 10),
      endDate: addDays(today(), 16),
    });
    const short = await setSchedule(ending.id, everyDay);
    expect(short.sessions).toMatchObject({ added: 7, through: addDays(today(), 16) });

    // One that has already ended generates nothing.
    const over = await addClass({
      name: 'Over',
      termId: null,
      startDate: addDays(today(), -30),
      endDate: addDays(today(), -1),
    });
    expect((await setSchedule(over.id, everyDay)).sessions).toEqual({
      added: 0,
      removed: 0,
      kept: 0,
      through: null,
    });
  });

  it('keeps the local time across a daylight-saving change, so the UTC time moves', async () => {
    const { make, addClass, setSchedule, sessionsOf } = await setup();
    // New Zealand's clocks go back on the first Sunday of April.
    const y = Number(today().slice(0, 4)) + 2;
    const year = await make<{ id: string }>('/academic-years', {
      name: 'Later',
      startDate: `${y}-03-01`,
      endDate: `${y}-04-30`,
    });
    const term = await make<{ id: string }>('/terms', {
      academicYearId: year.id,
      name: 'Across the change',
      startDate: `${y}-03-15`,
      endDate: `${y}-04-25`,
    });
    const klass = await addClass({ termId: term.id });
    await setSchedule(klass.id, [{ weekday: 3, startTime: '16:00', endTime: '17:00' }]);

    const list = await sessionsOf(klass.id, `${y}-03-01`, `${y}-04-30`);
    expect(list).toHaveLength(6);
    expect(new Set(list.map((s) => s.startTime))).toEqual(new Set(['16:00']));
    for (const s of list) expect(s.startsAt).toBe(localToUtc(s.date, '16:00', TZ));
    // 4 pm is 03:00 UTC in summer time (UTC+13) and 04:00 UTC after it ends (UTC+12).
    expect(list[0]!.startsAt.slice(11, 16)).toBe('03:00');
    expect(list.at(-1)!.startsAt.slice(11, 16)).toBe('04:00');
    expect(list.at(-1)!.endsAt.slice(11, 16)).toBe('05:00');
  });
});

describe('class changes and their sessions', () => {
  it('puts a new room and teacher on upcoming sessions, not on ones that have started', async () => {
    const { org, api, make, addClass, setSchedule, sessionsOf, lastAudit, room, main, member } =
      await setup();
    const room2 = await make<{ id: string }>(`/branches/${main.id}/rooms`, { name: 'Room 2' });
    const [first, second] = [await member('teacher'), await member('teacher')];
    const klass = await addClass({ roomId: room.id, teacherId: first.id });
    await setSchedule(klass.id, [TUE]);
    const started = await insertSession(org.id, klass.id, {
      date: addDays(today(), -1),
      startTime: '16:00',
      endTime: '17:00',
    });
    const cancelled = await insertSession(org.id, klass.id, {
      date: addDays(today(), 400),
      startTime: '16:00',
      endTime: '17:00',
      status: 'cancelled',
    });

    const res = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      roomId: room2.id,
      teacherId: second.id,
    });
    expect(res.status).toBe(200);

    const after = await sessionsOf(klass.id, addDays(today(), -30), addDays(today(), 500));
    const upcoming = after.filter((s) => s.id !== started && s.id !== cancelled);
    expect(upcoming).toHaveLength(10);
    expect(new Set(upcoming.map((s) => `${s.roomId} ${s.teacherId}`))).toEqual(
      new Set([`${room2.id} ${second.id}`]),
    );
    // Neither was generated with a room, and neither gets the new one.
    expect(after.find((s) => s.id === started)).toMatchObject({ roomId: null, teacherId: null });
    expect(after.find((s) => s.id === cancelled)).toMatchObject({ roomId: null, teacherId: null });
    expect((await lastAudit())[0]).toEqual(
      expect.objectContaining({
        action: 'class.updated',
        before: { roomId: room.id, teacherMembershipId: first.id },
        after: { roomId: room2.id, teacherMembershipId: second.id },
      }),
    );
  });

  it('adds and removes upcoming sessions when the class’s dates change', async () => {
    const { api, addClass, setSchedule, sessionsOf, lastAudit, start } = await setup();
    const klass = await addClass();
    await setSchedule(klass.id, [TUE]);
    const original = await sessionsOf(klass.id);

    const shortened = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: klass.updatedAt,
      endDate: addDays(start, 20),
    });
    expect(shortened.status).toBe(200);
    const kept = await sessionsOf(klass.id);
    expect(kept).toEqual(original.slice(0, 3));
    expect((await lastAudit())[0]).toMatchObject({
      action: 'class.updated',
      after: { endDate: addDays(start, 20), sessionsAdded: 0, sessionsRemoved: 7 },
    });

    const restored = await api('PATCH', `/classes/${klass.id}`, {
      updatedAt: shortened.body.updatedAt,
      endDate: null,
      startDate: addDays(start, 7),
    });
    expect(restored.status).toBe(200);
    expect((await sessionsOf(klass.id)).map((s) => s.date)).toEqual(weekly(start, 8, 9));
  });

  it('deletes a class’s schedule and all its sessions with it', async () => {
    const { org, api, addClass, setSchedule, sessionsOf } = await setup();
    const klass = await addClass();
    const other = await addClass({ name: 'Group B' });
    await setSchedule(klass.id, [TUE]);
    await setSchedule(other.id, [THU]);
    await insertSession(org.id, klass.id, {
      date: addDays(today(), -1),
      startTime: '16:00',
      endTime: '17:00',
    });

    expect((await api('DELETE', `/classes/${klass.id}`)).status).toBe(204);
    const left = await sessionsOf();
    expect(left).toHaveLength(10);
    expect(new Set(left.map((s) => s.classId))).toEqual(new Set([other.id]));
    expect((await api('PUT', `/classes/${klass.id}/schedule`, { slots: [TUE] })).status).toBe(404);
  });
});

describe('sessions', () => {
  it('lists a date range in date then time order, pages, and filters', async () => {
    const { api, make, addClass, setSchedule, room, main, subject, start, member } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const year9 = await make<{ id: string }>('/grade-levels', { name: 'Year 9' });
    const course9 = await make<{ id: string }>('/courses', {
      subjectId: subject.id,
      gradeLevelId: year9.id,
    });
    const teacher = await member('teacher');
    const a = await addClass({ name: 'A', roomId: room.id, teacherId: teacher.id });
    const b = await addClass({ name: 'B', branchId: albany.id });
    const c = await addClass({ name: 'C', courseId: course9.id });
    await setSchedule(a.id, [TUE, FRI]);
    await setSchedule(b.id, [{ weekday: 2, startTime: '09:00', endTime: '10:00' }]);
    await setSchedule(c.id, [TUE]);

    // The first week: Tuesday 09:00 (B), Tuesday 16:00 (A and C), Friday 09:00 (A).
    const week = `from=${start}&to=${addDays(start, 6)}`;
    const names = async (query = '') =>
      (await api('GET', `/sessions?${week}${query}`)).body.data.map(
        (s: Session) => `${s.className} ${weekday(s.date)} ${s.startTime}`,
      ) as string[];

    const all = await names();
    expect(all.slice(0, 1)).toEqual(['B 2 09:00']);
    expect(all.slice(1, 3).sort()).toEqual(['A 2 16:00', 'C 2 16:00']);
    expect(all.slice(3)).toEqual(['A 5 09:00']);

    expect(await names(`&branchId=${albany.id}`)).toEqual(['B 2 09:00']);
    expect(await names(`&branchId=${main.id}`)).toHaveLength(3);
    expect(await names(`&roomId=${room.id}`)).toEqual(['A 2 16:00', 'A 5 09:00']);
    expect(await names(`&teacherId=${teacher.id}`)).toEqual(['A 2 16:00', 'A 5 09:00']);
    expect(await names(`&gradeLevelId=${year9.id}`)).toEqual(['C 2 16:00']);
    expect(await names(`&classId=${b.id}`)).toEqual(['B 2 09:00']);
    expect(await names(`&classId=${a.id}&roomId=${room.id}&branchId=${albany.id}`)).toEqual([]);

    // One day, and a range with nothing in it.
    const tuesday = addDays(start, 1);
    const oneDay = await api('GET', `/sessions?from=${tuesday}&to=${tuesday}`);
    expect(oneDay.body.data).toHaveLength(3);
    const empty = await api('GET', `/sessions?from=${addDays(start, 2)}&to=${addDays(start, 3)}`);
    expect(empty.body).toEqual({ data: [], nextCursor: null });

    // Paging walks the whole week without repeats, two at a time.
    const first = await api('GET', `/sessions?${week}&limit=2`);
    const second = await api('GET', `/sessions?${week}&limit=2&cursor=${first.body.nextCursor}`);
    expect(first.body.data).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
    const paged = [...first.body.data, ...second.body.data].map((s: Session) => s.id);
    expect(new Set(paged).size).toBe(4);
    expect(
      [...first.body.data, ...second.body.data].map(
        (s: Session) => `${s.className} ${weekday(s.date)} ${s.startTime}`,
      ),
    ).toEqual(all);
  });

  it('needs a valid date range and known filter ids', async () => {
    const { api, start } = await setup();
    const fields = async (query: string) => {
      const res = await api('GET', `/sessions${query}`);
      expect(res.status).toBe(400);
      return Object.keys(res.body.error.fields);
    };
    expect(await fields('')).toEqual(['from', 'to']);
    expect(await fields(`?from=${start}`)).toEqual(['to']);
    expect(await fields(`?from=${start}&to=tomorrow`)).toEqual(['to']);
    expect(await fields(`?from=${start}&to=${addDays(start, -1)}`)).toEqual(['to']);
    expect(await fields(`?from=${start}&to=${start}&limit=500`)).toEqual(['limit']);

    const range = `?from=${start}&to=${start}`;
    const unknown = await Promise.all(
      ['branchId=brn_x', 'roomId=rm_x', 'teacherId=mem_x', 'gradeLevelId=grd_x', 'classId=cls_x']
        .map((q) => api('GET', `/sessions${range}&${q}`))
        .concat(api('GET', '/sessions/ses_nope')),
    );
    expect(unknown.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
  });
});

describe('a holiday added after sessions were generated', () => {
  it('removes the upcoming sessions it closes, and saving the schedule brings them back', async () => {
    const { org, api, make, addClass, setSchedule, sessionsOf, lastAudit, start } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const mainClass = await addClass({ name: 'Main group' });
    const albanyClass = await addClass({ name: 'Albany group', branchId: albany.id });
    await setSchedule(mainClass.id, [TUE]);
    await setSchedule(albanyClass.id, [TUE]);
    const tuesdays = weekly(start, 1, 10);
    const cancelled = await insertSession(org.id, mainClass.id, {
      date: tuesdays[2]!,
      startTime: '09:00',
      endTime: '10:00',
      status: 'cancelled',
    });

    // One branch's holiday closes only that branch.
    const albanyOnly = await api('POST', '/holidays', {
      name: 'Albany closed',
      startDate: tuesdays[0],
      endDate: tuesdays[0],
      branchId: albany.id,
    });
    expect(albanyOnly.status).toBe(201);
    expect((await sessionsOf(albanyClass.id)).map((s) => s.date)).toEqual(tuesdays.slice(1));
    expect(await sessionsOf(mainClass.id)).toHaveLength(11);
    expect((await lastAudit())[0]).toMatchObject({
      action: 'holiday.created',
      after: { name: 'Albany closed', sessionsRemoved: 1 },
    });

    // An organisation-wide one closes every branch. It leaves the cancelled session alone.
    const everywhere = await api('POST', '/holidays', {
      name: 'Mid-term break',
      startDate: addDays(start, 14),
      endDate: addDays(start, 20),
    });
    expect(everywhere.status).toBe(201);
    expect((await lastAudit())[0]!.after).toMatchObject({ sessionsRemoved: 2 });
    expect((await sessionsOf(albanyClass.id)).map((s) => s.date)).toEqual(
      tuesdays.filter((_, week) => week !== 0 && week !== 2),
    );
    const main = await sessionsOf(mainClass.id);
    expect(main.filter((s) => s.status === 'scheduled').map((s) => s.date)).toEqual(
      tuesdays.filter((_, week) => week !== 2),
    );
    expect(main.map((s) => s.id)).toContain(cancelled);

    // A holiday with nothing to close records zero.
    await api('POST', '/holidays', {
      name: 'Far away',
      startDate: addDays(start, 200),
      endDate: addDays(start, 201),
    });
    expect((await lastAudit())[0]!.after).toMatchObject({ sessionsRemoved: 0 });

    // Deleting the holiday doesn't restore them; saving the schedule again does.
    await api('DELETE', `/holidays/${everywhere.body.id}`);
    expect(await sessionsOf(albanyClass.id)).toHaveLength(8);
    const resaved = await setSchedule(albanyClass.id, [TUE]);
    expect(resaved.sessions).toMatchObject({ added: 1, removed: 0, kept: 8 });
    expect((await sessionsOf(albanyClass.id)).map((s) => s.date)).toEqual(tuesdays.slice(1));
  });

  it('leaves sessions that have already started', async () => {
    const { org, api, addClass, sessionsOf } = await setup();
    const klass = await addClass();
    const started = await insertSession(org.id, klass.id, {
      date: today(),
      startTime: '00:00',
      endTime: '00:30',
    });
    const res = await api('POST', '/holidays', {
      name: 'Declared late',
      startDate: addDays(today(), -1),
      endDate: today(),
    });
    expect(res.status).toBe(201);
    expect((await sessionsOf(klass.id)).map((s) => s.id)).toEqual([started]);
  });
});

describe('records a class uses', () => {
  it('refuses to delete a course, term, room or branch while a class uses it', async () => {
    const { api, make, addClass, course, term, room } = await setup();
    const albany = await make<{ id: string }>('/branches', { name: 'Albany' });
    const klass = await addClass({ roomId: room.id });
    const albanyClass = await addClass({ name: 'Albany group', branchId: albany.id });
    const refused = async (path: string) => {
      const res = await api('DELETE', path);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unprocessable');
      return res.body.error.message as string;
    };

    // The course list says so first, so the screen can tell before asking (TUI-113).
    const listed = async () =>
      (await api('GET', '/courses')).body.data.find((c: { id: string }) => c.id === course.id);
    expect((await listed()).classCount).toBe(2);
    expect(await refused(`/courses/${course.id}`)).toBe("Delete this course's 2 class(es) first.");
    expect(await refused(`/terms/${term.id}`)).toBe("Delete this term's 2 class(es) first.");
    expect(await refused(`/rooms/${room.id}`)).toBe(
      '1 class(es) use this room. Move them to another room first.',
    );
    expect(await refused(`/branches/${albany.id}`)).toBe("Delete this branch's 1 class(es) first.");

    // Moving the class out of the room frees the room; deleting the classes frees the rest.
    await api('PATCH', `/classes/${klass.id}`, { updatedAt: klass.updatedAt, roomId: null });
    expect((await api('DELETE', `/rooms/${room.id}`)).status).toBe(204);
    await api('DELETE', `/classes/${klass.id}`);
    await api('DELETE', `/classes/${albanyClass.id}`);
    expect((await listed()).classCount).toBe(0);
    const freed = await Promise.all([
      api('DELETE', `/courses/${course.id}`),
      api('DELETE', `/terms/${term.id}`),
      api('DELETE', `/branches/${albany.id}`),
    ]);
    expect(freed.map((r) => r.status)).toEqual([204, 204, 204]);
  });
});

describe('org isolation', () => {
  it("can't read or change another org's classes and sessions through any route", async () => {
    const alice = await setup();
    const klass = await alice.addClass();
    await alice.setSchedule(klass.id, [TUE]);
    const [session] = await alice.sessionsOf(klass.id);
    const bob = await setup();
    const range = `from=${alice.start}&to=${alice.end}`;

    const results = await Promise.all([
      bob.api('GET', `/classes/${klass.id}`),
      bob.api('PATCH', `/classes/${klass.id}`, { updatedAt: klass.updatedAt, capacity: 1 }),
      bob.api('DELETE', `/classes/${klass.id}`),
      bob.api('PUT', `/classes/${klass.id}/schedule`, { slots: [] }),
      bob.api('GET', `/sessions/${session!.id}`),
      bob.api('GET', `/sessions?${range}&classId=${klass.id}`),
      call('GET', `${alice.base}/classes`, { token: bob.owner.token }),
      call('GET', `${alice.base}/sessions?${range}`, { token: bob.owner.token }),
      call('POST', `${alice.base}/classes`, { token: bob.owner.token, body: {} }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404, 404]);

    expect((await bob.api('GET', '/classes')).body.data).toEqual([]);
    expect(await bob.sessionsOf()).toEqual([]);
    expect(await alice.sessionsOf(klass.id)).toHaveLength(10);
    expect((await alice.api('GET', `/classes/${klass.id}`)).body.capacity).toBeNull();
  });
});

describe('permissions', () => {
  /** Two branches with a class each; the Main one is taught by `teacher`. */
  async function twoBranches() {
    const org = await setup();
    const albany = await org.make<{ id: string }>('/branches', { name: 'Albany' });
    const teacher = await org.member('teacher');
    const mainClass = await org.addClass({ name: 'Main group', teacherId: teacher.id });
    const albanyClass = await org.addClass({ name: 'Albany group', branchId: albany.id });
    await org.setSchedule(mainClass.id, [TUE]);
    await org.setSchedule(albanyClass.id, [THU]);
    const [mainSession] = await org.sessionsOf(mainClass.id);
    const [albanySession] = await org.sessionsOf(albanyClass.id);
    const range = `from=${org.start}&to=${org.end}&limit=200`;
    return {
      ...org,
      albany,
      teacher,
      mainClass,
      albanyClass,
      mainSession: mainSession!,
      albanySession: albanySession!,
      range,
    };
  }
  type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;
  const classNames = async (as: As) =>
    (await as('GET', '/classes')).body.data.map((k: Class) => k.name) as string[];
  const sessionClasses = async (as: As, range: string) => [
    ...new Set(
      (await as('GET', `/sessions?${range}`)).body.data.map(
        (s: Session) => s.className,
      ) as string[],
    ),
  ];

  it('refuses an accountant on every route', async () => {
    const { member, mainClass, mainSession, range } = await twoBranches();
    const { as } = await member('accountant');
    const results = await Promise.all([
      as('GET', '/classes'),
      as('POST', '/classes', {}),
      as('GET', `/classes/${mainClass.id}`),
      as('PATCH', `/classes/${mainClass.id}`, { updatedAt: mainClass.updatedAt }),
      as('DELETE', `/classes/${mainClass.id}`),
      as('PUT', `/classes/${mainClass.id}/schedule`, { slots: [] }),
      as('GET', `/sessions?${range}`),
      as('GET', `/sessions/${mainSession.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
  });

  it('lets a teacher read only the classes they teach, and change nothing', async () => {
    const { teacher, mainClass, albanyClass, mainSession, albanySession, range, course, main } =
      await twoBranches();
    const { as } = teacher;

    expect(await classNames(as)).toEqual(['Main group']);
    expect((await as('GET', `/classes/${mainClass.id}`)).status).toBe(200);
    expect((await as('GET', `/classes/${albanyClass.id}`)).status).toBe(404);
    expect(await sessionClasses(as, range)).toEqual(['Main group']);
    expect((await as('GET', `/sessions/${mainSession.id}`)).status).toBe(200);
    expect((await as('GET', `/sessions/${albanySession.id}`)).status).toBe(404);
    expect((await as('GET', `/sessions?${range}&classId=${albanyClass.id}`)).status).toBe(404);

    const writes = await Promise.all([
      as('POST', '/classes', { courseId: course.id, branchId: main.id, name: 'Nope' }),
      as('PATCH', `/classes/${mainClass.id}`, { updatedAt: mainClass.updatedAt, capacity: 1 }),
      as('DELETE', `/classes/${mainClass.id}`),
      as('PUT', `/classes/${mainClass.id}/schedule`, { slots: [] }),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403]);
  });

  it('shows a parent with no enrolled children no classes or sessions', async () => {
    const { member, mainClass, mainSession, range } = await twoBranches();
    const { as } = await member('parent');

    expect(await classNames(as)).toEqual([]);
    expect((await as('GET', `/classes/${mainClass.id}`)).status).toBe(404);
    expect((await as('GET', `/sessions?${range}`)).body).toEqual({ data: [], nextCursor: null });
    expect((await as('GET', `/sessions/${mainSession.id}`)).status).toBe(404);
    expect((await as('POST', '/classes', {})).status).toBe(403);
    expect((await as('PUT', `/classes/${mainClass.id}/schedule`, { slots: [] })).status).toBe(403);
  });

  it.each(['branch_manager', 'front_desk'] as Role[])(
    'keeps a %s limited to one branch inside that branch',
    async (role) => {
      const t = await twoBranches();
      const staff = await t.member(role, [t.albany.id]);
      const { as } = staff;

      expect(await classNames(as)).toEqual(['Albany group']);
      expect(await sessionClasses(as, t.range)).toEqual(['Albany group']);
      const outside = await Promise.all([
        as('GET', `/classes/${t.mainClass.id}`),
        as('PATCH', `/classes/${t.mainClass.id}`, {
          updatedAt: t.mainClass.updatedAt,
          capacity: 1,
        }),
        as('DELETE', `/classes/${t.mainClass.id}`),
        as('PUT', `/classes/${t.mainClass.id}/schedule`, { slots: [] }),
        as('GET', `/sessions/${t.mainSession.id}`),
      ]);
      expect(outside.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
      // They know the Main branch exists, so adding a class there is refused, not hidden.
      const elsewhere = await as('POST', '/classes', {
        courseId: t.course.id,
        termId: t.term.id,
        branchId: t.main.id,
        name: 'Sneaky',
      });
      expect(elsewhere.status).toBe(403);
      expect(await t.sessionsOf(t.mainClass.id)).toHaveLength(10);

      // Inside their branch they do everything, and the audit rows name them.
      const created = await as('POST', '/classes', {
        courseId: t.course.id,
        termId: t.term.id,
        branchId: t.albany.id,
        name: 'New group',
      });
      expect(created.status).toBe(201);
      const scheduled = await as('PUT', `/classes/${created.body.id}/schedule`, { slots: [FRI] });
      expect(scheduled.status).toBe(200);
      expect(scheduled.body.sessions.added).toBe(10);
      const updated = await as('PATCH', `/classes/${created.body.id}`, {
        updatedAt: created.body.updatedAt,
        capacity: 6,
      });
      expect(updated.status).toBe(200);
      expect((await as('GET', `/sessions/${t.albanySession.id}`)).status).toBe(200);
      expect((await as('DELETE', `/classes/${created.body.id}`)).status).toBe(204);
      expect((await t.lastAudit(4)).map((e) => [e.action, e.actorUserId])).toEqual([
        ['class.deleted', staff.userId],
        ['class.updated', staff.userId],
        ['class.schedule_set', staff.userId],
        ['class.created', staff.userId],
      ]);
    },
  );

  it('lets branch staff with no branch limit work in every branch', async () => {
    const t = await twoBranches();
    const { as } = await t.member('branch_manager');
    expect(await classNames(as)).toEqual(['Main group', 'Albany group']);
    const created = await as('POST', '/classes', {
      courseId: t.course.id,
      termId: t.term.id,
      branchId: t.main.id,
      name: 'Anywhere',
    });
    expect(created.status).toBe(201);
  });

  it('shows staff limited to no branches nothing', async () => {
    const t = await twoBranches();
    const { as } = await t.member('front_desk', []);
    expect(await classNames(as)).toEqual([]);
    expect((await as('GET', `/sessions?${t.range}`)).body.data).toEqual([]);
    expect((await as('GET', `/classes/${t.mainClass.id}`)).status).toBe(404);
  });
});
