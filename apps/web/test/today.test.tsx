import { screen, waitFor, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { HomePage } from '../src/pages/HomePage';
import { LessonPage } from '../src/pages/classes/LessonPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// A teacher's Today (TUI-57): the next lesson, today's lessons, quick attendance and what needs
// attention. Also the homework on the attendance sheet, which shares quick attendance's code.

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'teacher') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'jason@example.com',
          name: 'Jason Lee',
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
const from = addDays(today, -14);
const to = addDays(today, 7);

const routes = [
  { path: '/o/:orgSlug', element: <HomePage /> },
  { path: '/o/:orgSlug/lessons/:sessionId', element: <LessonPage /> },
];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const unmarked = { present: 0, late: 0, absent: 0, excused: 0 };

const lesson = (id: string, date: string, start: string, end: string, extra = {}) => ({
  id,
  classId: `cls_${id}`,
  className: `Class ${id}`,
  courseId: 'crs_1',
  branchId: 'brn_main',
  roomId: 'rm_3',
  roomName: 'Room 3',
  teacherId: 'mem_me',
  teacherName: 'Jason Lee',
  date,
  startTime: start,
  endTime: end,
  startsAt: `${date}T00:00:00.000Z`,
  endsAt: `${date}T23:59:00.000Z`,
  status: 'scheduled',
  movedFrom: null,
  attendance: unmarked,
  createdAt: at,
  updatedAt: at,
  ...extra,
});
// Times that hold whatever the clock says: one that's over, one on now, one still to come.
const done = lesson('done', today, '00:00', '00:01', {
  attendance: { present: 8, late: 0, absent: 1, excused: 0 },
});
const onNow = lesson('now', today, '00:00', '23:59');
const later = lesson('later', today, '23:58', '23:59');
const cancelled = lesson('off', today, '23:00', '23:30', { status: 'cancelled' });

const record = (id: string, first: string, notice: unknown = null) => ({
  studentId: id,
  studentFirstName: first,
  studentLastName: 'Perera',
  status: null,
  markedAt: null,
  absenceNotice: notice,
});
const roster = (sessionId: string) => ({
  body: {
    sessionId,
    records: [
      record('stu_a', 'Aria'),
      record('stu_k', 'Kavi', {
        id: 'abn_1',
        source: 'parent',
        reason: 'sick',
        startDate: today,
        endDate: today,
      }),
    ],
  },
});
const notes = (sessionId: string) => ({
  body: { sessionId, homework: null, homeworkUpdatedAt: null, notes: [] },
});

function stubToday(sessions: unknown[], extra: Record<string, unknown> = {}) {
  return stubApi({
    [`${API}/sessions?from=${from}&to=${to}&limit=200`]: page(sessions),
    [`${API}/classes?limit=200`]: page([
      { id: 'cls_now', name: 'Class now', courseId: 'crs_1', enrolledCount: 9 },
    ]),
    [`${API}/absence-notices?from=${today}&to=${to}&limit=200`]: page([]),
    [`${API}/courses?limit=200`]: page([]),
    [`${API}/subjects?limit=200`]: page([]),
    [`${API}/grade-levels`]: page([]),
    [`${API}/sessions/now/attendance`]: roster('now'),
    [`${API}/sessions/now/notes`]: notes('now'),
    ...(extra as Record<string, { body: unknown }>),
  });
}

describe("a teacher's Today", () => {
  it('shows the lesson on now, who is away, and how each lesson today stands', async () => {
    stubToday([done, onNow, cancelled, later]);
    renderRoutes(routes, '/o/bright-minds', inOrg('teacher'));

    expect(await screen.findByText('3 lessons today · 1 to mark')).toBeVisible();
    expect(screen.getByText('On now')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Class now' })).toBeVisible();
    expect(screen.getAllByText('9 students')[0]).toBeVisible();
    expect(await screen.findByText('1 away today')).toBeVisible();

    const rows = within(
      screen.getByRole('heading', { name: 'Today’s lessons' }).closest('section')!,
    );
    expect(rows.getByText('8 present · 1 absent')).toBeVisible();
    expect(rows.getByRole('button', { name: 'Mark' })).toBeVisible();
    expect(rows.getByText('Cancelled')).toBeVisible();
    expect(screen.getByText('All caught up')).toBeVisible();
  });

  it('takes attendance and the homework without leaving the page', async () => {
    const calls = stubToday([onNow], {
      'PUT /api/v1/orgs/org_1/sessions/now/attendance': { body: { sessionId: 'now', records: [] } },
      'PUT /api/v1/orgs/org_1/sessions/now/notes': { body: { sessionId: 'now' } },
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('teacher'));
    await userEvent.click(await screen.findByRole('button', { name: 'Take attendance' }));

    const dialog = await screen.findByRole('dialog', { name: 'Class now' });
    // Kavi's parent said he's away, so he starts as excused.
    expect(within(dialog).getByText('1 of 2 marked')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark the rest present' }));
    await userEvent.type(within(dialog).getByLabelText(/Homework for the class/), 'Textbook p.42');
    expect(within(dialog).getByText('3 changes')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save attendance' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.key.endsWith('/sessions/now/attendance') && c.key.startsWith('PUT'))
          ?.body,
      ).toEqual({
        records: [
          { studentId: 'stu_a', status: 'present' },
          { studentId: 'stu_k', status: 'excused' },
        ],
      }),
    );
    expect(calls.find((c) => c.key === 'PUT /api/v1/orgs/org_1/sessions/now/notes')?.body).toEqual({
      homework: 'Textbook p.42',
    });
    expect(await screen.findByText('Attendance saved')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('points out earlier lessons left unmarked and absences this week', async () => {
    const old = lesson('old', addDays(today, -3), '16:00', '17:00');
    stubToday([old], {
      [`${API}/absence-notices?from=${today}&to=${to}&limit=200`]: page([
        {
          id: 'abn_2',
          studentId: 'stu_m',
          studentFirstName: 'Maia',
          studentLastName: 'Ngata',
          startDate: addDays(today, 2),
          endDate: addDays(today, 2),
          reason: null,
          source: 'parent',
          createdAt: at,
          updatedAt: at,
        },
      ]),
      [`${API}/sessions/old/attendance`]: roster('old'),
      [`${API}/sessions/old/notes`]: notes('old'),
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('teacher'));

    expect(await screen.findByText('1 earlier lesson not marked')).toBeVisible();
    expect(await screen.findByText('1 absence reported this week')).toBeVisible();
    expect(screen.getByText(/^Maia Ngata ·/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Mark / }));
    expect(await screen.findByRole('dialog', { name: 'Class old' })).toBeVisible();
  });

  it('says when the next lesson is on a day without any', async () => {
    stubToday([lesson('thu', addDays(today, 2), '16:00', '17:00')]);
    renderRoutes(routes, '/o/bright-minds', inOrg('teacher'));

    expect(await screen.findAllByText('No lessons today')).not.toHaveLength(0);
    expect(screen.getByText(/^Next: .* · Class thu$/)).toBeVisible();
    // Attendance opens on the lesson's day.
    expect(screen.queryByRole('button', { name: 'Take attendance' })).toBeNull();
  });

  it('is only for teachers: other staff get the staff home', () => {
    stubApi({});
    renderRoutes(routes, '/o/bright-minds', inOrg('accountant'));
    expect(screen.queryByText('Today’s lessons')).toBeNull();
    expect(screen.getByText(/what’s happening across Bright Minds/)).toBeVisible();
  });
});

describe('the attendance sheet', () => {
  it('saves the homework for the class with the marks', async () => {
    const calls = stubApi({
      [`${API}/sessions/now`]: { body: onNow },
      [`${API}/sessions/now/attendance`]: roster('now'),
      [`${API}/sessions/now/notes`]: notes('now'),
      'PUT /api/v1/orgs/org_1/sessions/now/attendance': { body: { sessionId: 'now', records: [] } },
      'PUT /api/v1/orgs/org_1/sessions/now/notes': { body: { sessionId: 'now' } },
    });
    renderRoutes(routes, '/o/bright-minds/lessons/now', inOrg('teacher'));
    await userEvent.type(await screen.findByLabelText(/Homework for the class/), 'Worksheet 3');
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'PUT /api/v1/orgs/org_1/sessions/now/notes')?.body,
      ).toEqual({
        homework: 'Worksheet 3',
      }),
    );
  });
});
