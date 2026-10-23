import { guardians, memberships, sessions, users } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// What classes and lessons show of other modules (TUI-112): the teacher's and room's names, the
// places taken, the attendance counts on a lesson, and who a class can be given to.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };

/**
 * An owner with an open-ended class that started a week ago, taught on every weekday, in Room 1
 * of the Main branch, plus a second branch.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const north = await make('/branches', { name: 'North' });
  const room = await make(`/branches/${main.id}/rooms`, { name: 'Room 1' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 9' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    durationMinutes: 60,
  });

  /** A member of the org, with a name on their user when one is given. */
  const member = async (role: Role, name?: string, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    if (name) await db().update(users).set({ name }).where(eq(users.id, user.userId));
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as = (method: string, path: string, body?: unknown) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const student = (firstName: string) =>
    make('/students', { familyId: family.id, firstName, lastName: 'Perera' });

  return { api, make, orgId: org.id, main, north, room, course, member, family, student };
}

describe('a class shows its teacher, room and places taken', () => {
  it('on create, read, list and update', async () => {
    const { api, make, main, room, course, member, student } = await setup();
    const teacher = await member('teacher', 'Nimali Perera');
    const other = await member('teacher'); // no name: their email stands in

    const created = await make<Record<string, unknown> & Row>('/classes', {
      courseId: course.id,
      branchId: main.id,
      name: 'Group A',
      startDate: addDays(today(), -7),
      roomId: room.id,
      teacherId: teacher.id,
      capacity: 12,
    });
    expect(created).toMatchObject({
      teacherName: 'Nimali Perera',
      roomName: 'Room 1',
      enrolledCount: 0,
    });

    // Places taken: active enrolments that haven't ended, including one that starts later.
    const [a, b, c, d] = await Promise.all(['Aria', 'Maia', 'Jack', 'Isha'].map(student));
    await make('/enrolments', { studentId: a!.id, classId: created.id });
    await make('/enrolments', {
      studentId: b!.id,
      classId: created.id,
      startDate: addDays(today(), 14),
    });
    const ended = await make('/enrolments', {
      studentId: c!.id,
      classId: created.id,
      startDate: addDays(today(), -7),
      endDate: addDays(today(), -1),
    });
    const left = await make('/enrolments', { studentId: d!.id, classId: created.id });
    const withdrawn = await api('PATCH', `/enrolments/${left.id}`, {
      updatedAt: left.updatedAt,
      status: 'withdrawn',
      endDate: addDays(today(), -1),
    });
    expect(withdrawn.status).toBe(200);
    expect(ended.id).toBeDefined();

    const read = (await api('GET', `/classes/${created.id}`)).body;
    expect(read).toMatchObject({
      teacherName: 'Nimali Perera',
      roomName: 'Room 1',
      enrolledCount: 2,
    });
    expect((await api('GET', '/classes')).body.data).toEqual([read]);

    // A new teacher and no room: the answer has the new names, and a read agrees.
    const updated = await api('PATCH', `/classes/${created.id}`, {
      updatedAt: read.updatedAt,
      teacherId: other.id,
      roomId: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      teacherName: 'teacher@example.com',
      roomName: null,
      enrolledCount: 2,
    });
    expect((await api('GET', `/classes/${created.id}`)).body).toEqual(updated.body);

    // Saving the schedule answers with the class as shown too.
    const scheduled = await api('PUT', `/classes/${created.id}/schedule`, {
      slots: [{ weekday: 2, startTime: '16:00' }],
    });
    expect(scheduled.body.class).toMatchObject({ teacherName: 'teacher@example.com' });
  });
});

describe('a lesson shows its teacher, room and attendance counts', () => {
  async function withLesson() {
    const s = await setup();
    const teacher = await s.member('teacher', 'Nimali Perera');
    const klass = await s.make<Row>('/classes', {
      courseId: s.course.id,
      branchId: s.main.id,
      name: 'Group A',
      startDate: addDays(today(), -7),
      roomId: s.room.id,
      teacherId: teacher.id,
    });
    // Every day from now on: the generator only adds lessons that haven't started.
    await s.api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '16:00' })),
    });
    // Two lessons that have passed, to mark: as a schedule saved last week would have added.
    for (const days of [2, 1]) {
      await db()
        .insert(sessions)
        .values({
          id: newId('session'),
          orgId: s.orgId,
          classId: klass.id,
          roomId: s.room.id,
          teacherMembershipId: teacher.id,
          date: addDays(today(), -days),
          startTime: '16:00',
          endTime: '17:00',
        });
    }
    const students = await Promise.all(['Aria', 'Maia', 'Jack'].map(s.student));
    for (const st of students) {
      await s.make('/enrolments', {
        studentId: st.id,
        classId: klass.id,
        startDate: addDays(today(), -7),
      });
    }
    const range = `from=${addDays(today(), -2)}&to=${addDays(today(), -1)}`;
    const lessons = (await s.api('GET', `/sessions?${range}&classId=${klass.id}`)).body.data as {
      id: string;
    }[];
    return { ...s, teacher, klass, students, lessons, range };
  }

  it('counts the marks for staff, and leaves them out for parents', async () => {
    const { api, make, member, family, teacher, klass, students, lessons, range } =
      await withLesson();
    const lesson = lessons[0]!;
    const marked = await api('PUT', `/sessions/${lesson.id}/attendance`, {
      records: [
        { studentId: students[0]!.id, status: 'present' },
        { studentId: students[1]!.id, status: 'present' },
        { studentId: students[2]!.id, status: 'absent' },
      ],
    });
    expect(marked.status).toBe(200);

    const one = (await api('GET', `/sessions/${lesson.id}`)).body;
    expect(one).toMatchObject({
      teacherName: 'Nimali Perera',
      roomName: 'Room 1',
      attendance: { present: 2, late: 0, absent: 1, excused: 0 },
    });
    const list = (await api('GET', `/sessions?${range}&classId=${klass.id}`)).body.data;
    expect(list[0]).toEqual(one);
    expect(list[1].attendance).toEqual({ present: 0, late: 0, absent: 0, excused: 0 });

    // The class's teacher sees the counts on their own lessons.
    const asTeacher = await teacher.as('GET', `/sessions/${lesson.id}`);
    expect(asTeacher.body.attendance).toEqual(one.attendance);

    // A parent sees the lesson but not how the rest of the class was marked.
    const parent = await member('parent');
    const guardian = await make(`/families/${family.id}/guardians`, {
      firstName: 'Ruwan',
      lastName: 'Perera',
    });
    // What accepting an invite will do: tie the guardian to the parent's membership.
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, guardian.id));
    const asParent = await parent.as('GET', `/sessions/${lesson.id}`);
    expect(asParent.status).toBe(200);
    expect(asParent.body.teacherName).toBe('Nimali Perera');
    expect(asParent.body).not.toHaveProperty('attendance');
    const portal = await parent.as('GET', `/portal/sessions?${range}`);
    expect(portal.status).toBe(200);
    expect(portal.body.data[0]).not.toHaveProperty('attendance');
  });

  it('answers a change of teacher or room with the new names', async () => {
    const { api, member, lessons } = await withLesson();
    const lesson = (await api('GET', `/sessions/${lessons.at(-1)!.id}`)).body;
    const cover = await member('teacher', 'Sam Lee');
    // Lessons that have started can't change, so this changes one that hasn't: tomorrow's.
    const tomorrow = addDays(today(), 1);
    const later = await api('GET', `/sessions?from=${tomorrow}&to=${tomorrow}`);
    const next = later.body.data[0];
    const changed = await api('PATCH', `/sessions/${next.id}`, {
      updatedAt: next.updatedAt,
      teacherId: cover.id,
      roomId: null,
      notify: false,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.session).toMatchObject({ teacherName: 'Sam Lee', roomName: null });
    expect((await api('GET', `/sessions/${next.id}`)).body).toEqual(changed.body.session);
    expect(lesson.roomName).toBe('Room 1');
  });
});

describe('GET /teachers', () => {
  it('lists active staff by name, for anyone who can change classes', async () => {
    const { api, main, north, member } = await setup();
    const nimali = await member('teacher', 'Nimali Perera');
    const sam = await member('teacher', 'Sam Lee', [north.id]);
    const desk = await member('front_desk', 'Ana Front', [main.id]);
    const gone = await member('teacher', 'Zed Gone');
    await db().update(memberships).set({ status: 'suspended' }).where(eq(memberships.id, gone.id));
    await member('parent', 'A Parent');
    const accountant = await member('accountant', 'Acc Ount');
    const teacher = nimali;

    const all = await api('GET', '/teachers');
    expect(all.status).toBe(200);
    expect(all.body.nextCursor).toBeNull();
    const names = all.body.data.map((t: { name: string }) => t.name);
    // By name; the owner has no name, so their email stands in. No parent or suspended member.
    expect(names).toEqual([
      'Acc Ount',
      'Ana Front',
      'Nimali Perera',
      'owner@example.com',
      'Sam Lee',
    ]);
    expect(all.body.data.find((t: { id: string }) => t.id === sam.id)).toEqual({
      id: sam.id,
      name: 'Sam Lee',
      role: 'teacher',
      branchIds: [north.id],
    });

    // Front desk limited to Main: those with no branch list or one that includes Main.
    const mine = await desk.as('GET', '/teachers');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((t: { name: string }) => t.name)).toEqual([
      'Acc Ount',
      'Ana Front',
      'Nimali Perera',
      'owner@example.com',
    ]);

    // Roles that can't change classes are refused.
    expect((await teacher.as('GET', '/teachers')).status).toBe(403);
    expect((await accountant.as('GET', '/teachers')).status).toBe(403);

    // Another org's id is 404 to someone who isn't in it.
    const stranger = await newUser('owner');
    const theirs = await newOrg(stranger.token, 'Other Centre');
    const res = await desk.as('GET', '/teachers');
    expect(res.status).toBe(200);
    const outside = await call('GET', `/api/v1/orgs/${theirs.id}/teachers`, {
      token: (await newUser('owner')).token,
    });
    expect(outside.status).toBe(404);
  });
});
