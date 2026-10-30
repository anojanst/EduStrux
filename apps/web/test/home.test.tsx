import { screen, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { HomePage } from '../src/pages/HomePage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The staff Home (TUI-125): money or counts, today's lessons, what needs attention and quick
// actions, each for the roles that can read it.

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg = (role: Role) => (tree: ReactNode) => (
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
const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
const yesterday = addDays(today, -1);
const from = addDays(today, -14);
const routes = [{ path: '/o/:orgSlug', element: <HomePage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const nzd = (amount: number) => ({ amount, currency: 'NZD' });
const unmarked = { present: 0, late: 0, absent: 0, excused: 0 };

const lesson = (id: string, date: string, start: string, end: string, extra = {}) => ({
  id,
  classId: `cls_${id}`,
  className: `Class ${id}`,
  courseId: 'crs_1',
  branchId: 'brn_main',
  roomId: 'rm_3',
  roomName: 'Room 3',
  teacherId: 'mem_t',
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
const done = lesson('done', today, '00:00', '00:01', {
  attendance: { present: 8, late: 0, absent: 1, excused: 0 },
});
const onNow = lesson('now', today, '00:00', '23:59');
const later = lesson('later', today, '23:58', '23:59');

const dashboard = (extra = {}) => ({
  body: {
    date: today,
    families: 23,
    students: 41,
    classes: 9,
    today: { lessons: 3, cancelled: 0, marked: 1, absenceNotices: 2 },
    // Today's two unmarked lessons, and three from earlier days.
    unmarkedLessons: 5,
    makeupCreditsAvailable: 1,
    money: {
      owing: nzd(420000),
      overdue: nzd(18000),
      overdueInvoices: 2,
      receivedThisMonth: nzd(96000),
      draftInvoices: 4,
    },
    ...extra,
  },
});

function stubHome(extra: Record<string, unknown> = {}) {
  return stubApi({
    [`${API}/reports/dashboard`]: dashboard(),
    [`${API}/sessions?from=${today}&to=${today}&limit=200`]: page([done, onNow, later]),
    [`${API}/sessions?from=${from}&to=${yesterday}&limit=200`]: page([
      lesson('old', addDays(today, -3), '16:00', '17:00'),
    ]),
    [`${API}/sessions/old/attendance`]: { body: { sessionId: 'old', records: [] } },
    [`${API}/sessions/old/notes`]: {
      body: { sessionId: 'old', homework: null, homeworkUpdatedAt: null, notes: [] },
    },
    ...(extra as Record<string, { body: unknown }>),
  });
}

describe('the staff Home', () => {
  it('shows the owner money, today’s lessons and what needs attention', async () => {
    stubHome();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));

    expect(await screen.findByText('$4,200.00')).toBeVisible();
    expect(screen.getByText('Review drafts →')).toBeVisible();
    expect(
      await screen.findByText('Bright Minds Tuition · 3 lessons today · 1 to mark'),
    ).toBeVisible();

    const lessons = within(
      screen.getByRole('heading', { name: 'Today’s lessons' }).closest('section')!,
    );
    expect(lessons.getByText('8 present · 1 absent')).toBeVisible();
    expect(lessons.getAllByText('Room 3 · Jason Lee')[0]).toBeVisible();
    expect(lessons.getByRole('button', { name: 'Mark' })).toBeVisible();

    const attention = within(
      screen.getByRole('heading', { name: 'Needs attention' }).closest('aside')!,
    );
    expect(attention.getByText('Earlier lessons not marked').closest('li')).toHaveTextContent('3');
    expect(attention.getByText('Students away today').closest('li')).toHaveTextContent('2');
    expect(attention.getByText('Make-up credits to book')).toBeVisible();
    expect(attention.getByText('$180.00 past its due date')).toBeVisible();

    expect(screen.getByRole('button', { name: /Run invoices/ })).toBeVisible();
    expect(screen.queryByText('Getting started')).toBeNull();
  });

  it('opens the oldest unmarked lesson from Needs attention', async () => {
    stubHome();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: /Oldest is .* mark it now/ }));
    expect(await screen.findByRole('dialog', { name: 'Class old' })).toBeVisible();
  });

  it('gives front desk the centre’s counts and no money', async () => {
    const calls = stubHome({
      [`${API}/reports/dashboard`]: dashboard({ money: undefined }),
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('front_desk'));

    expect(await screen.findByText('Families')).toBeVisible();
    expect(screen.getByText('41')).toBeVisible();
    expect(screen.getByText('1 marked')).toBeVisible();
    expect(screen.queryByText('Total owing')).toBeNull();
    expect(screen.queryByText('Overdue invoices')).toBeNull();
    expect(screen.getByRole('button', { name: /Record payment/ })).toBeVisible();
    expect(calls.some((c) => c.key.includes('/audit-log'))).toBe(false);
  });

  it('says when everything is caught up', async () => {
    stubHome({
      [`${API}/reports/dashboard`]: dashboard({
        today: { lessons: 1, cancelled: 0, marked: 1, absenceNotices: 0 },
        unmarkedLessons: 0,
        makeupCreditsAvailable: 0,
        money: undefined,
      }),
      [`${API}/sessions?from=${today}&to=${today}&limit=200`]: page([done]),
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('branch_manager'));
    expect(await screen.findByText('All caught up')).toBeVisible();
  });

  const emptyCentre = () =>
    stubHome({
      [`${API}/reports/dashboard`]: dashboard({
        families: 0,
        students: 0,
        classes: 0,
        today: { lessons: 0, cancelled: 0, marked: 0, absenceNotices: 0 },
        unmarkedLessons: 0,
        makeupCreditsAvailable: 0,
      }),
      [`${API}/sessions?from=${today}&to=${today}&limit=200`]: page([]),
    });

  it('walks a new centre through its first steps', async () => {
    emptyCentre();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));

    expect(await screen.findByText('Getting started')).toBeVisible();
    // The owner finishes the setup wizard (TUI-64), which ends with the first class.
    expect(screen.getByRole('link', { name: /Finish setting up your centre/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/setup',
    );
    expect(screen.queryByRole('link', { name: /Add your first class/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Invite your team/ })).toBeVisible();
    expect(screen.getAllByText('No lessons today')[0]).toBeVisible();
  });

  it('sends other staff in a new centre to courses and classes, not the wizard', async () => {
    emptyCentre();
    renderRoutes(routes, '/o/bright-minds', inOrg('branch_manager'));

    expect(await screen.findByText('Getting started')).toBeVisible();
    expect(screen.getByRole('link', { name: /Add your first class/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes',
    );
    expect(screen.queryByRole('link', { name: /Finish setting up/ })).toBeNull();
  });

  it('gives an accountant their invoices and payments, without the dashboard', async () => {
    const calls = stubApi({});
    renderRoutes(routes, '/o/bright-minds', inOrg('accountant'));

    expect(screen.getByRole('link', { name: /Invoices/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/invoices',
    );
    expect(screen.getByRole('link', { name: /Payments/ })).toBeVisible();
    expect(screen.queryByText('Today’s lessons')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
