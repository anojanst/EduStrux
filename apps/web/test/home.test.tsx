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
const inOrg = (role: Role, settings?: object) => (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: {
        id: 'usr_1',
        email: 'olivia@example.com',
        name: 'Olivia Hart',
        memberships: [{ id: 'mem_me', role, branchIds: null, org }],
      },
      membership: { id: 'mem_me', role, branchIds: null, org },
      org: settings as never,
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

/** The owner's setup lists: a centre with a branch and grades, and nothing else yet. */
const setupLists = {
  [`${API}/tax-rates?limit=200`]: page([]),
  [`${API}/branches?limit=200`]: page([{ id: 'brn_main', name: 'Main', updatedAt: at }]),
  [`${API}/branches/brn_main/rooms?limit=200`]: page([{ id: 'rm_3', name: 'Room 3' }]),
  [`${API}/academic-years?limit=200`]: page([]),
  [`${API}/grade-levels`]: page([{ id: 'grd_1', name: 'Year 1' }]),
  [`${API}/subjects?limit=200`]: page([]),
  [`${API}/staff?limit=2`]: page([{ id: 'mem_me' }]),
  [`${API}/classes?limit=200`]: page([{ id: 'cls_1' }]),
  [`${API}/billing/subscription`]: {
    body: { plan: 'small', studentLimit: 50, activeStudents: 45, subscription: null },
  },
};

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
    ...setupLists,
    ...(extra as Record<string, { body: unknown }>),
  });
}

/** A count's tile on Home, found by its label (the first on the page with that text). */
const stat = (label: string) =>
  screen.getAllByText(label)[0]!.closest<HTMLElement>('[class*="min-h-[84px]"]')!;

// The staff Home (TUI-130, from the owner's Figma Make design): four counts for today, today's
// lessons with the next one picked out, money at a glance, and the owner's setup checklist and
// student limit.
describe('the staff Home', () => {
  it('shows the owner today’s counts, lessons, money and what’s left to set up', async () => {
    stubHome();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));

    expect(await screen.findByText('$4,200.00')).toBeVisible();
    expect(screen.getByText('4 drafts to issue')).toBeVisible();
    expect(screen.getByText('$180.00')).toHaveClass('text-danger');
    expect(screen.getByText('Across 2 invoices')).toBeVisible();

    // Three lessons today; the one on now is picked out, and today's one to take plus three
    // from earlier days are to mark.
    expect(await screen.findByText('3 lessons today')).toBeVisible();
    expect(stat('Attendance to take')).toHaveTextContent('4');
    expect(stat('Absence notices')).toHaveTextContent('2');
    expect(stat('Make-up credits')).toHaveTextContent('1');
    // The lesson on now is picked out at the top, with attendance to take.
    expect(screen.getAllByText('Attendance to take')).toHaveLength(2);
    expect(screen.getByText('8 present · 1 absent')).toBeVisible();

    const checklist = within(
      screen.getByRole('heading', { name: 'Set up your centre' }).closest('div.rounded-xl')!,
    );
    expect(await checklist.findByText('Just 3 things left to do')).toBeVisible();
    expect(checklist.getByRole('link', { name: /Set up terms & dates/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/setup?step=calendar',
    );
    expect(checklist.getByRole('link', { name: /Add grade levels/ })).toHaveTextContent('Done');
    expect(await screen.findByText('You’re nearing your student limit')).toBeVisible();
    expect(screen.getByText('45 of 50 active students on your plan.')).toBeVisible();
  });

  it('leaves the checklist out once the owner finished the setup', async () => {
    stubHome();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner', { ...org, setupCompletedAt: at }));
    expect(await screen.findByText('3 lessons today')).toBeVisible();
    expect(await screen.findByText('You’re nearing your student limit')).toBeVisible();
    expect(screen.queryByText('Set up your centre')).toBeNull();
  });

  it('keeps the right column useful: quick actions and the plan (TUI-134)', async () => {
    stubHome({
      [`${API}/billing/subscription`]: {
        body: { plan: 'small', status: 'active', studentLimit: 50, activeStudents: 10 },
      },
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('owner', { ...org, setupCompletedAt: at }));

    const actions = within(screen.getByRole('heading', { name: 'Quick actions' }).parentElement!);
    expect(actions.getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual([
      'Add family',
      'Add class',
      'Record payment',
      'Run invoices',
    ]);
    expect(await screen.findByText('10 of 50 active students on your plan.')).toBeVisible();
    expect(screen.getByText('Small plan')).toBeVisible();
    expect(screen.queryByText('You’re nearing your student limit')).toBeNull();
  });

  it('gives other staff quick actions without the plan', async () => {
    const calls = stubHome({ [`${API}/reports/dashboard`]: dashboard({ money: undefined }) });
    renderRoutes(routes, '/o/bright-minds', inOrg('front_desk'));
    expect(await screen.findByRole('heading', { name: 'Quick actions' })).toBeVisible();
    expect(screen.queryByText('Your plan')).toBeNull();
    expect(calls.some((c) => c.key.includes('/billing/subscription'))).toBe(false);
  });

  it('opens the oldest unmarked lesson from Attendance to take', async () => {
    stubHome();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));
    await screen.findByText('3 lessons today');
    await userEvent.click(stat('Attendance to take'));
    expect(await screen.findByRole('dialog', { name: 'Class old' })).toBeVisible();
  });

  it('gives front desk the counts and lessons, and no money or checklist', async () => {
    const calls = stubHome({
      [`${API}/reports/dashboard`]: dashboard({ money: undefined }),
    });
    renderRoutes(routes, '/o/bright-minds', inOrg('front_desk'));

    expect(await screen.findByText('3 lessons today')).toBeVisible();
    expect(screen.queryByText('Money at a glance')).toBeNull();
    expect(screen.queryByText('Set up your centre')).toBeNull();
    expect(calls.some((c) => c.key.includes('/billing/subscription'))).toBe(false);
  });

  it('tells the owner about the trial and where setup left off', async () => {
    stubHome();
    renderRoutes(
      routes,
      '/o/bright-minds',
      inOrg('owner', {
        ...org,
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 9 * 86_400_000 - 60_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    expect(screen.getByText('14-day free trial')).toBeVisible();
    expect(screen.getByText('Make the most of your free trial')).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/o/bright-minds/setup?step=calendar',
    );
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
      [`${API}/classes?limit=200`]: page([]),
    });

  it('walks a new centre’s owner through setup with the checklist', async () => {
    emptyCentre();
    renderRoutes(routes, '/o/bright-minds', inOrg('owner'));

    expect(await screen.findByRole('link', { name: /Add your first class/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes',
    );
    expect(screen.queryByText('Getting started')).toBeNull();
    expect(screen.getAllByText('No lessons today')[0]).toBeVisible();
  });

  it('sends other staff in a new centre to courses and classes', async () => {
    emptyCentre();
    renderRoutes(routes, '/o/bright-minds', inOrg('branch_manager'));

    expect(await screen.findByText('Getting started')).toBeVisible();
    expect(screen.getByRole('link', { name: /Add your first class/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes',
    );
    expect(screen.queryByText('Set up your centre')).toBeNull();
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
