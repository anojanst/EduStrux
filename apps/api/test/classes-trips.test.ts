import { createDb, guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Access, OrgCtx } from '../src/db/scope';
import { countTrips } from '../src/middleware/db';
import * as classes from '../src/modules/classes/service';
import { call, db, newOrg, newUser } from './helpers';

// The budget for an endpoint is about 3 database stages: sign-in, one read stage, one write
// (D-102). A read has no write, so it gets 2. Each class and session endpoint is called once
// here, on its heaviest path: every optional check switched on. `stages` is held to the budget.
// `trips` is held to what the request made when TUI-96 was built, so a change that adds a call
// fails here.

type Res = Awaited<ReturnType<typeof call>>;
type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => Promise<Res>;

const READ = 2;
const WRITE = 3;

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));

const TUE = { weekday: 2, startTime: '16:00', endTime: '17:00' };
const THU = { weekday: 4, startTime: '16:00' }; // its end comes from the course's lesson length

/** Holds one request to its budget. The messages name the request, so a failure says which. */
function within(res: Res, request: string, status: number, max: { stages: number; trips: number }) {
  expect(res.status, request).toBe(status);
  expect(res.db.stages, `${request}: stages`).toBeLessThanOrEqual(max.stages);
  expect(res.db.trips, `${request}: trips`).toBeLessThanOrEqual(max.trips);
}

/**
 * A centre with one class, Group A, in a ten-week term that has a holiday in it. The teacher
 * teaches the class and the parent's child Mia is enrolled in it, so both read what the owner
 * reads.
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
  const room = await make(`/branches/${main.id}/rooms`, { name: 'Room 1' });
  const otherRoom = await make(`/branches/${main.id}/rooms`, { name: 'Room 2' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    durationMinutes: 60,
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
  await make('/holidays', {
    name: 'Mid-term break',
    startDate: addDays(start, 21),
    endDate: addDays(start, 27),
  });

  const teacher = await member('teacher');
  const otherTeacher = await member('teacher');
  const parent = await member('parent');

  const klass = await make('/classes', {
    courseId: course.id,
    termId: term.id,
    branchId: main.id,
    roomId: room.id,
    teacherId: teacher.id,
    name: 'Group A',
  });
  const scheduled = await api('PUT', `/classes/${klass.id}/schedule`, { slots: [TUE] });
  if (scheduled.status !== 200) throw new Error('schedule failed for Group A');
  const range = `from=${start}&to=${end}`;
  const lessons = await api('GET', `/sessions?classId=${klass.id}&${range}`);
  const session = lessons.body.data[0] as Row;

  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const guardian = await make(`/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db()
    .update(guardians)
    .set({ membershipId: parent.id })
    .where(eq(guardians.id, guardian.id));
  const mia = await make('/students', {
    familyId: family.id,
    firstName: 'Mia',
    lastName: 'Perera',
  });
  await make('/enrolments', { studentId: mia.id, classId: klass.id });

  return {
    org,
    api,
    teacher,
    otherTeacher,
    parent,
    main,
    room,
    otherRoom,
    grade,
    course,
    term,
    start,
    end,
    range,
    klass,
    session,
    mia,
  };
}

describe('class and session endpoints stay within the database budget', () => {
  it('adding, scheduling, changing and deleting a class', async () => {
    const c = await centre();

    // The course, term, branch, room, teacher and name are each checked: six reads, one stage.
    const add = await c.api('POST', '/classes', {
      courseId: c.course.id,
      termId: c.term.id,
      branchId: c.main.id,
      roomId: c.room.id,
      teacherId: c.teacher.id,
      name: 'Group B',
      startDate: c.start,
      endDate: c.end,
    });
    within(add, 'POST /classes', 201, { stages: WRITE, trips: 8 });
    const path = `/classes/${add.body.id}`;

    // The class, its slots, its course's lesson length, its term, the holidays and the sessions
    // it already has. Two lessons a week for ten weeks, less the week of the holiday.
    const schedule = await c.api('PUT', `${path}/schedule`, { slots: [TUE, THU] });
    within(schedule, 'PUT /classes/{id}/schedule', 200, { stages: WRITE, trips: 8 });
    expect(schedule.body.sessions).toMatchObject({ added: 18, removed: 0, kept: 0 });

    // A new name, room and teacher are each checked, and a new end date moves the sessions.
    const change = await c.api('PATCH', path, {
      updatedAt: add.body.updatedAt,
      name: 'Group C',
      roomId: c.otherRoom.id,
      teacherId: c.otherTeacher.id,
      endDate: addDays(c.end, -14),
    });
    within(change, 'PATCH /classes/{id}', 200, { stages: WRITE, trips: 10 });

    // The class, its enrolments and its price rules.
    const drop = await c.api('DELETE', path);
    within(drop, 'DELETE /classes/{id}', 204, { stages: WRITE, trips: 5 });
  });

  it('reading classes and sessions, the same for the owner, a teacher and a parent', async () => {
    const c = await centre();
    const classFilters =
      `branchId=${c.main.id}&termId=${c.term.id}&courseId=${c.course.id}` +
      `&gradeLevelId=${c.grade.id}&teacherId=${c.teacher.id}`;
    const sessionFilters =
      `${c.range}&branchId=${c.main.id}&roomId=${c.room.id}&teacherId=${c.teacher.id}` +
      `&gradeLevelId=${c.grade.id}&classId=${c.klass.id}`;
    const callers: [string, As][] = [
      ['owner', c.api],
      ['teacher', c.teacher.as],
      ['parent', c.parent.as],
    ];

    for (const [role, as] of callers) {
      // Five filter ids are checked beside the page and its weekly slots.
      const list = await as('GET', `/classes?${classFilters}`);
      within(list, `GET /classes, ${role}`, 200, { stages: READ, trips: 8 });
      expect(list.body.data, role).toHaveLength(1);
      expect(list.body.data[0].schedule, role).toEqual([TUE]);

      const one = await as('GET', `/classes/${c.klass.id}`);
      within(one, `GET /classes/{id}, ${role}`, 200, { stages: READ, trips: 3 });

      // Five filter ids are checked beside the page.
      const sessions = await as('GET', `/sessions?${sessionFilters}`);
      within(sessions, `GET /sessions, ${role}`, 200, { stages: READ, trips: 7 });
      expect(sessions.body.data, role).toHaveLength(9);

      const session = await as('GET', `/sessions/${c.session.id}`);
      within(session, `GET /sessions/{id}, ${role}`, 200, { stages: READ, trips: 2 });
    }
  });

  // One stage over the budget, and not this module's: `people.getStudent` reads the student and
  // then their grades, two stages. The sessions are read beside it, so this drops to 2 when
  // TUI-95 makes that read one stage.
  it('a student’s timetable waits only for the read of the student', async () => {
    const c = await centre();
    const callers: [string, As][] = [
      ['owner', c.api],
      ['teacher', c.teacher.as],
      ['parent', c.parent.as],
    ];

    for (const [role, as] of callers) {
      const timetable = await as('GET', `/sessions?${c.range}&studentId=${c.mia.id}`);
      within(timetable, `GET /sessions?studentId, ${role}`, 200, { stages: 3, trips: 5 });
      expect(timetable.body.data, role).toHaveLength(9);
    }
  });
});

describe('what other modules read of classes and sessions', () => {
  it('is one stage each', async () => {
    const c = await centre();
    const org = (await db().query.orgs.findFirst({ where: (o, { eq }) => eq(o.id, c.org.id) }))!;
    const owner: Access = { scope: 'all', role: 'owner', membershipId: 'mem_x', branchIds: null };
    const term = { startDate: c.start, endDate: c.end };
    const klass = (await c.api('GET', `/classes/${c.klass.id}`)).body;

    // The read, the call another module makes, and how many D1 calls it sends together.
    const reads: [string, (ctx: OrgCtx) => unknown, number][] = [
      ['getClass', (ctx) => classes.getClass(ctx, owner, c.klass.id), 2],
      ['getSession', (ctx) => classes.getSession(ctx, owner, c.session.id), 1],
      ['classLabels', (ctx) => classes.classLabels(ctx, [c.klass.id]), 1],
      ['lessonDates', (ctx) => classes.lessonDates(ctx, [c.klass.id], term), 1],
      ['classDates', (ctx) => classes.classDates(ctx, klass), 1],
      ['countClasses', (ctx) => classes.countClasses(ctx, { branchId: c.main.id }), 1],
      ['classesBilledIn', (ctx) => classes.classesBilledIn(ctx, { termId: c.term.id }), 1],
      ['sessionsClosedBy', (ctx) => classes.sessionsClosedBy(ctx, { ...term, branchId: null }), 1],
    ];

    for (const [read, send, trips] of reads) {
      const { d1, counts } = countTrips(env.DB);
      // As in a request: the org is already on the context, so reading it costs nothing.
      await send({ db: createDb(d1), orgId: c.org.id, actorUserId: null, org });
      expect(counts.stages, `${read}: stages`).toBe(1);
      expect(counts.trips, `${read}: trips`).toBeLessThanOrEqual(trips);
    }
  });
});
