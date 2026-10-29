import { screen, waitFor, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { weekOf } from '../src/lib/classes';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { hourBounds, layoutLanes, stepDate, viewRange } from '../src/lib/timetable';
import { TimetablePage } from '../src/pages/timetable/TimetablePage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The timetable (TUI-51): day, week and month views of GET /sessions, clashes, and moving a lesson.

describe('the timetable helpers', () => {
  it('covers a day, a Monday-to-Sunday week, and the whole weeks of a month', () => {
    expect(viewRange('day', '2026-10-14')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(viewRange('week', '2026-10-14')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(viewRange('month', '2026-10-14')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
  });

  it('steps a day, a week or a month, across the year', () => {
    expect(stepDate('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepDate('week', '2026-10-14', -1)).toBe('2026-10-07');
    expect(stepDate('month', '2026-12-20', 1)).toBe('2027-01-01');
    expect(stepDate('month', '2026-01-05', -1)).toBe('2025-12-01');
  });

  it('puts overlapping lessons side by side, and the rest full width', () => {
    const places = layoutLanes([
      { id: 'a', startTime: '16:00', endTime: '17:00' },
      { id: 'b', startTime: '16:15', endTime: '17:15' },
      { id: 'c', startTime: '17:00', endTime: '18:00' },
      { id: 'd', startTime: '19:00', endTime: '20:00' },
    ]);
    expect(places.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(places.get('b')).toEqual({ lane: 1, lanes: 2 });
    // c starts when a ends, so it reuses a's lane in the same group.
    expect(places.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(places.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('shows 7:00 to 21:00, wider for an early or late lesson', () => {
    expect(hourBounds([{ startTime: '16:00', endTime: '17:00' }])).toEqual({ start: 7, end: 21 });
    expect(hourBounds([{ startTime: '06:30', endTime: '21:15' }])).toEqual({ start: 6, end: 22 });
  });
});

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Hart',
          memberships: [{ id: 'mem_me', role, branchIds: null, org }],
        },
        membership: { id: 'mem_me', role, branchIds: null, org },
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
// Dates the app reads in the browser's timezone, since the org's settings aren't loaded here.
const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
const monday = weekOf(today);
const sunday = addDays(monday, 6);
const nextWeek = addDays(monday, 7);
// A day next week, so "Now" and attendance don't depend on the clock.
const later = addDays(monday, 9);

const routes = [{ path: '/o/:orgSlug/timetable', element: <TimetablePage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const lookups = {
  [`${API}/terms?limit=200`]: page([]),
  [`${API}/branches?limit=200`]: page([{ id: 'brn_main', name: 'Main', address: null }]),
  [`${API}/branches/brn_main/rooms?limit=200`]: page([
    { id: 'rm_2', branchId: 'brn_main', name: 'Room 2', capacity: null },
    { id: 'rm_3', branchId: 'brn_main', name: 'Room 3', capacity: null },
  ]),
  [`${API}/subjects?limit=200`]: page([]),
  [`${API}/courses?limit=200`]: page([]),
  [`${API}/grade-levels`]: page([]),
  [`${API}/classes?limit=200`]: page([]),
  [`${API}/holidays?limit=200`]: page([]),
  [`${API}/teachers`]: page([
    { id: 'mem_np', name: 'Nimali Perera', role: 'teacher', branchIds: null },
    { id: 'mem_jl', name: 'Jason Lee', role: 'teacher', branchIds: null },
  ]),
};

const lesson = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  classId: `cls_${id}`,
  className: `Class ${id}`,
  courseId: 'crs_1',
  branchId: 'brn_main',
  roomId: 'rm_2',
  roomName: 'Room 2',
  teacherId: 'mem_np',
  teacherName: 'Nimali Perera',
  date,
  startTime: '16:00',
  endTime: '17:00',
  startsAt: `${date}T04:00:00.000Z`,
  endsAt: `${date}T05:00:00.000Z`,
  status: 'scheduled',
  movedFrom: null,
  attendance: { present: 0, late: 0, absent: 0, excused: 0 },
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const clashSession = (s: ReturnType<typeof lesson>) => ({
  id: s.id,
  classId: s.classId,
  className: s.className,
  branchId: s.branchId,
  startTime: s.startTime,
  endTime: s.endTime,
});

const sessionsKey = (from: string, to: string, extra = '') =>
  `${API}/sessions?from=${from}&to=${to}&limit=200${extra}`;
const clashesKey = (from: string, to: string) => `${API}/timetable/clashes?from=${from}&to=${to}`;
const noClashes = (from: string, to: string) => ({
  [clashesKey(from, to)]: { body: { data: [] } },
});

describe('the week view', () => {
  it("shows the week's lessons with their clashes, cancellations and moves", async () => {
    const a = lesson('a', monday);
    const b = lesson('b', monday, { className: 'Year 8 Maths' });
    const c = lesson('c', addDays(monday, 2), { status: 'cancelled' });
    const d = lesson('d', addDays(monday, 3), {
      movedFrom: { date: addDays(monday, 4), startTime: '16:00' },
    });
    const calls = stubApi({
      ...lookups,
      [sessionsKey(monday, sunday)]: page([a, b, c, d]),
      [clashesKey(monday, sunday)]: {
        body: {
          data: [
            {
              kind: 'room',
              date: monday,
              sessions: [clashSession(a), clashSession(b)],
              roomId: 'rm_2',
              teacherId: null,
              gradeLevelId: null,
              studentId: null,
              studentFirstName: null,
              studentLastName: null,
            },
          ],
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/timetable', inOrg('owner'));

    expect(await screen.findByRole('button', { name: /^Class a, .*Clash$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Year 8 Maths, .*Clash$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Class c, .*Cancelled$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Class d, .*Moved from .*, Moved$/ })).toBeVisible();
    expect(screen.getByText('1 clash this week')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Week', pressed: true })).toBeVisible();
    expect(calls.some((x) => x.key === sessionsKey(monday, sunday))).toBe(true);
  });

  it('reviews a clash on its day, by room', async () => {
    const a = lesson('a', later);
    const b = lesson('b', later);
    const weekFrom = weekOf(later);
    const clash = {
      kind: 'teacher',
      date: later,
      sessions: [clashSession(a), clashSession(b)],
      roomId: null,
      teacherId: 'mem_np',
      gradeLevelId: null,
      studentId: null,
      studentFirstName: null,
      studentLastName: null,
    };
    stubApi({
      ...lookups,
      [sessionsKey(weekFrom, addDays(weekFrom, 6))]: page([a, b]),
      [clashesKey(weekFrom, addDays(weekFrom, 6))]: { body: { data: [clash] } },
      [sessionsKey(later, later)]: page([a, b]),
      [clashesKey(later, later)]: { body: { data: [clash] } },
    });
    renderRoutes(routes, `/o/bright-minds/timetable?date=${later}`, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(await screen.findByRole('button', { name: 'Day', pressed: true })).toBeVisible();
    // Both lessons are in Room 2: one column, with the room's name at its head.
    expect(screen.getByText('Room 2', { selector: 'span.truncate' })).toBeVisible();
    expect(screen.getByText('1 clash in these dates')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  });

  it('moves to the next week, and filters by room', async () => {
    stubApi({
      ...lookups,
      [sessionsKey(monday, sunday)]: page([]),
      ...noClashes(monday, sunday),
      [sessionsKey(nextWeek, addDays(nextWeek, 6))]: page([lesson('n', nextWeek)]),
      ...noClashes(nextWeek, addDays(nextWeek, 6)),
      [sessionsKey(nextWeek, addDays(nextWeek, 6), '&roomId=rm_3')]: page([]),
    });
    renderRoutes(routes, '/o/bright-minds/timetable', inOrg('owner'));
    expect(await screen.findAllByText('No lessons this week')).not.toHaveLength(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]!);
    expect(await screen.findByRole('button', { name: /^Class n,/ })).toBeVisible();

    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Room' })[0]!, 'rm_3');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Class n,/ })).toBeNull());
  });
});

describe('the month view', () => {
  it('lists three lessons a day and opens the day for the rest', async () => {
    const { from, to } = viewRange('month', later);
    const lessons = ['a', 'b', 'c', 'd', 'e'].map((id) => lesson(id, later));
    stubApi({
      ...lookups,
      [sessionsKey(from, to)]: page(lessons),
      ...noClashes(from, to),
      [sessionsKey(later, later)]: page(lessons),
      ...noClashes(later, later),
    });
    renderRoutes(routes, `/o/bright-minds/timetable?view=month&date=${later}`, inOrg('owner'));

    await userEvent.click(await screen.findByRole('button', { name: '+2 more' }));
    expect(await screen.findByRole('button', { name: 'Day', pressed: true })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Class e,/ })[0]).toBeInTheDocument();
  });
});

describe('a lesson', () => {
  it('opens with its details, and moves to another room', async () => {
    const a = lesson('a', later);
    const weekFrom = weekOf(later);
    const calls = stubApi({
      ...lookups,
      [sessionsKey(weekFrom, addDays(weekFrom, 6))]: page([a]),
      ...noClashes(weekFrom, addDays(weekFrom, 6)),
      'PATCH /api/v1/orgs/org_1/sessions/a': {
        body: { session: { ...a, roomId: 'rm_3', roomName: 'Room 3' }, messageId: null },
      },
    });
    renderRoutes(routes, `/o/bright-minds/timetable?date=${later}`, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: /^Class a,/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Class a' });
    expect(within(dialog).getByText('Room 2')).toBeVisible();
    expect(within(dialog).getByText('Nimali Perera')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Open class' })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes/cls_a',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lesson actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move lesson' }));

    const move = await screen.findByRole('dialog', { name: 'Move lesson' });
    await userEvent.selectOptions(await within(move).findByLabelText('Room'), 'rm_3');
    await userEvent.click(within(move).getByRole('button', { name: 'Move lesson' }));

    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/v1/orgs/org_1/sessions/a')?.body).toEqual({
        updatedAt: at,
        roomId: 'rm_3',
      }),
    );
    expect(await screen.findByText('Lesson moved')).toBeVisible();
  });

  it('checks the times before moving', async () => {
    const a = lesson('a', later);
    const weekFrom = weekOf(later);
    const calls = stubApi({
      ...lookups,
      [sessionsKey(weekFrom, addDays(weekFrom, 6))]: page([a]),
      ...noClashes(weekFrom, addDays(weekFrom, 6)),
    });
    renderRoutes(routes, `/o/bright-minds/timetable?date=${later}`, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: /^Class a,/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Class a' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lesson actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move lesson' }));

    const move = await screen.findByRole('dialog', { name: 'Move lesson' });
    await userEvent.clear(within(move).getByLabelText(/^End time/));
    await userEvent.type(within(move).getByLabelText(/^End time/), '15:00');
    await userEvent.click(within(move).getByRole('button', { name: 'Move lesson' }));

    expect(within(move).getByText('Must be after the start time')).toBeVisible();
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });

  it("can't be moved or cancelled by a teacher", async () => {
    const a = lesson('a', later);
    const weekFrom = weekOf(later);
    const calls = stubApi({
      ...lookups,
      [sessionsKey(weekFrom, addDays(weekFrom, 6))]: page([a]),
      ...noClashes(weekFrom, addDays(weekFrom, 6)),
    });
    renderRoutes(routes, `/o/bright-minds/timetable?date=${later}`, inOrg('teacher'));
    await userEvent.click(await screen.findByRole('button', { name: /^Class a,/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Class a' });
    expect(within(dialog).queryByRole('button', { name: 'Lesson actions' })).toBeNull();
    // A teacher can't list who teaches, so the page doesn't ask.
    expect(calls.some((c) => c.key === `${API}/teachers`)).toBe(false);
  });
});

describe('one student', () => {
  it('finds a student by name and shows only their lessons', async () => {
    stubApi({
      ...lookups,
      ...noClashes(monday, sunday),
      [`${API}/search?q=amaya&limit=8`]: {
        body: {
          families: [],
          guardians: [],
          students: [
            {
              id: 'stu_1',
              familyId: 'fam_1',
              familyName: 'Perera',
              branchId: 'brn_main',
              firstName: 'Amaya',
              lastName: 'Perera',
            },
          ],
        },
      },
      [`${API}/students/stu_1`]: { body: { id: 'stu_1', firstName: 'Amaya', lastName: 'Perera' } },
      [sessionsKey(monday, sunday, '&studentId=stu_1')]: page([lesson('s', monday)]),
    });
    renderRoutes(routes, '/o/bright-minds/timetable?by=student', inOrg('owner'));

    await userEvent.type(await screen.findByLabelText('Find a student'), 'amaya');
    await userEvent.click(await screen.findByRole('button', { name: /Amaya Perera/ }));
    expect(await screen.findByRole('button', { name: /^Class s,/ })).toBeVisible();
    expect(screen.getByText('Amaya Perera')).toBeVisible();
  });
});

describe('who sees the timetable', () => {
  it('is not for parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/timetable', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
