import { screen, waitFor, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import { viewRange } from '../src/lib/timetable';
import { HomePage } from '../src/pages/HomePage';
import { PortalInvoices } from '../src/pages/portal/PortalInvoices';
import { PortalMessages } from '../src/pages/portal/PortalMessages';
import { PortalTimetable } from '../src/pages/portal/PortalTimetable';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The parent portal (TUI-126): Home, the timetable with a lesson's homework and notes, reporting
// an absence, invoices and messages, each read through the portal routes.

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const asParent = (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: {
        id: 'usr_p',
        email: 'priya@example.com',
        name: 'Priya Perera',
        memberships: [{ id: 'mem_p', role: 'parent', branchIds: null, org }],
      },
      membership: { id: 'mem_p', role: 'parent', branchIds: null, org },
      org: undefined,
    }}
  >
    <ToastProvider>{tree}</ToastProvider>
  </OrgContext.Provider>
);

const API = 'GET /api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
const tomorrow = addDays(today, 1);
const week = viewRange('week', today);
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const nzd = (amount: number) => ({ amount, currency: 'NZD' });

const aria = { id: 'stu_a', firstName: 'Aria', lastName: 'Perera' };
const kavi = { id: 'stu_k', firstName: 'Kavi', lastName: 'Perera' };
const enrolment = (studentId: string, className: string) => ({
  id: `enr_${className}`,
  studentId,
  studentFirstName: 'x',
  studentLastName: 'Perera',
  classId: `cls_${className}`,
  className,
  courseId: 'crs_1',
  branchId: 'brn_1',
  startDate: '2026-01-01',
  endDate: null,
  priceOverride: null,
  status: 'active',
  createdAt: at,
  updatedAt: at,
});
const children = page([
  {
    ...aria,
    familyId: 'fam_1',
    familyName: 'Perera',
    branchId: 'brn_1',
    dateOfBirth: null,
    gradeLevelId: 'g7',
    enrolments: [enrolment('stu_a', 'Year 7 English')],
  },
  {
    ...kavi,
    familyId: 'fam_1',
    familyName: 'Perera',
    branchId: 'brn_1',
    dateOfBirth: null,
    gradeLevelId: 'g9',
    enrolments: [enrolment('stu_k', 'Year 9 Maths')],
  },
]);

const lesson = (id: string, date: string, child: typeof aria, extra = {}) => ({
  id,
  classId: `cls_${id}`,
  className: `Class ${id}`,
  courseId: 'crs_1',
  branchId: 'brn_1',
  roomId: 'rm_3',
  roomName: 'Room 3',
  teacherId: 'mem_t',
  teacherName: 'Ms Perera',
  date,
  startTime: '23:58',
  endTime: '23:59',
  startsAt: `${date}T00:00:00.000Z`,
  endsAt: `${date}T23:59:00.000Z`,
  status: 'scheduled',
  movedFrom: null,
  children: [child],
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const notes = (
  sessionId: string,
  homework: string | null,
  note: string | null = null,
  child = aria,
) => ({
  body: {
    sessionId,
    homework,
    homeworkUpdatedAt: homework ? at : null,
    notes: [
      {
        studentId: child.id,
        studentFirstName: child.firstName,
        studentLastName: child.lastName,
        note,
        updatedAt: null,
      },
    ],
  },
});
const invoice = (id: string, number: string, balance: number, extra = {}) => ({
  id,
  familyId: 'fam_1',
  familyName: 'Perera',
  branchId: 'brn_1',
  status: 'issued',
  number,
  termId: null,
  month: '2026-10',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  bankReference: '7K2M9QXA',
  dueDate: addDays(today, 7),
  notes: null,
  subtotal: nzd(balance),
  tax: nzd(0),
  total: nzd(balance),
  paid: nzd(0),
  balance: nzd(balance),
  lines: [],
  issuedAt: at,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const invoices = page([
  invoice('inv_1', 'INV-0042', 42000),
  invoice('inv_2', 'INV-0038', 18000, { dueDate: addDays(today, -3) }),
  invoice('inv_3', 'INV-0031', 0, { status: 'paid', paid: nzd(25000) }),
]);
const grades = page([
  { id: 'g7', name: 'Year 7', sortOrder: 1 },
  { id: 'g9', name: 'Year 9', sortOrder: 2 },
]);

describe("a parent's Home", () => {
  it('shows the next lesson, the children, the homework and the balance', async () => {
    const moved = lesson('maths', today, kavi, {
      movedFrom: { date: today, startTime: '16:00' },
    });
    const past = lesson('english', addDays(today, -3), aria);
    stubApi({
      [`${API}/portal/children`]: children,
      [`${API}/grade-levels`]: grades,
      [`${API}/portal/sessions?from=${today}&to=${addDays(today, 14)}&limit=200`]: page([moved]),
      [`${API}/portal/sessions?from=${addDays(today, -21)}&to=${today}&limit=200`]: page([past]),
      [`${API}/sessions/english/notes`]: notes('english', 'Read chapter 6.'),
      [`${API}/portal/invoices?limit=200`]: invoices,
    });
    renderRoutes([{ path: '/o/:orgSlug', element: <HomePage /> }], '/o/bright-minds', asParent);

    const next = (await screen.findByText('Next lesson')).closest('div')!;
    expect(within(next).getByText('Kavi Perera')).toBeVisible();
    expect(within(next).getByText('Moved')).toBeVisible();
    expect(within(next).getByText('Today')).toBeVisible();
    expect(next.querySelector('del')).toHaveTextContent(/4:00/);

    expect(await screen.findByText('Year 7 · Year 7 English')).toBeVisible();
    expect(screen.getByRole('link', { name: /Kavi Perera/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/timetable?child=stu_k',
    );
    expect(await screen.findByText('Read chapter 6.')).toBeVisible();
    expect(screen.getByText('$600.00')).toBeVisible();
    expect(screen.getByText('Overdue $180.00')).toBeVisible();
  });
});

describe("a parent's timetable", () => {
  const sessions = [
    lesson('maths', today, kavi, { movedFrom: { date: today, startTime: '16:00' } }),
    lesson('english', tomorrow, aria, { status: 'cancelled' }),
  ];
  const timetable = {
    [`${API}/portal/children`]: children,
    [`${API}/holidays?limit=200`]: page([]),
    [`${API}/portal/sessions?from=${week.from}&to=${week.to}&limit=200`]: page(sessions),
  };

  it('lists the week by day, and filters to one child', async () => {
    const calls = stubApi({
      ...timetable,
      [`${API}/portal/sessions?from=${week.from}&to=${week.to}&studentId=stu_a&limit=200`]: page(
        sessions.slice(1),
      ),
    });
    renderRoutes(
      [{ path: '/o/:orgSlug/timetable', element: <PortalTimetable /> }],
      '/o/bright-minds/timetable',
      asParent,
    );

    expect(await screen.findByText(/^Today, /)).toBeVisible();
    expect(screen.getByText('Kavi · Room 3 · Ms Perera')).toBeVisible();
    expect(screen.getByText('Moved')).toBeVisible();
    expect(screen.getByText('Cancelled')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Aria' }));
    await waitFor(() => expect(screen.queryByText('Class maths')).toBeNull());
    expect(calls.some((c) => c.key.includes('studentId=stu_a'))).toBe(true);
  });

  it('opens a lesson with its homework and the teacher’s note', async () => {
    stubApi({
      ...timetable,
      [`${API}/sessions/maths/notes`]: notes(
        'maths',
        'Questions 4–12.',
        'Great focus today.',
        kavi,
      ),
    });
    renderRoutes(
      [{ path: '/o/:orgSlug/timetable', element: <PortalTimetable /> }],
      '/o/bright-minds/timetable',
      asParent,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Class maths/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Class maths' });
    expect(await within(sheet).findByText('Questions 4–12.')).toBeVisible();
    expect(within(sheet).getByText('Teacher’s note about Kavi')).toBeVisible();
    expect(
      within(sheet).getByRole('button', { name: 'Report absence for this lesson' }),
    ).toBeVisible();
  });

  it('reports an absence, saying which lessons it covers', async () => {
    const calls = stubApi({
      ...timetable,
      [`${API}/sessions/maths/notes`]: notes('maths', null),
      [`${API}/portal/sessions?from=${today}&to=${today}&studentId=stu_k&limit=200`]: page([
        sessions[0],
      ]),
      'POST /api/v1/orgs/org_1/portal/absence-notices': { status: 201, body: {} },
    });
    renderRoutes(
      [{ path: '/o/:orgSlug/timetable', element: <PortalTimetable /> }],
      '/o/bright-minds/timetable',
      asParent,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Class maths/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Report absence for this lesson' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Report an absence' });
    expect(within(dialog).getByRole('radio', { name: 'Kavi' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await within(dialog).findByText('Kavi will miss 1 lesson')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Away sick');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to the centre' }));

    expect(await screen.findByText('Thanks – the centre has been told')).toBeVisible();
    expect(calls.find((c) => c.key.startsWith('POST'))?.body).toEqual({
      studentId: 'stu_k',
      startDate: today,
      reason: 'Away sick',
    });
  });
});

describe("a parent's invoices and messages", () => {
  it('lists the invoices with what’s owed and how to pay', async () => {
    stubApi({ [`${API}/portal/invoices?limit=200`]: invoices });
    renderRoutes(
      [{ path: '/o/:orgSlug/invoices', element: <PortalInvoices /> }],
      '/o/bright-minds/invoices',
      asParent,
    );

    expect(await screen.findByText('$600.00')).toBeVisible();
    expect(screen.getByText('INV-0038').closest('button')).toHaveTextContent('Overdue');
    expect(screen.getByText('INV-0031').closest('button')).toHaveTextContent('Paid');
    expect(
      screen.getByText('Use your family reference 7K2M9QXA when you pay the centre.'),
    ).toBeVisible();

    await userEvent.click(screen.getByText('INV-0042'));
    const sheet = await screen.findByRole('dialog', { name: 'INV-0042' });
    expect(within(sheet).getByRole('button', { name: 'Download PDF' })).toBeVisible();
  });

  it('reads a message in full', async () => {
    stubApi({
      [`${API}/portal/messages?limit=200`]: page([
        {
          id: 'msg_1',
          kind: 'automatic',
          event: 'session_moved',
          subject: 'Lesson moved',
          body: 'Kavi’s lesson has moved to 5:00 pm.\nSee you then.',
          familyIds: ['fam_1'],
          createdAt: new Date().toISOString(),
        },
      ]),
    });
    renderRoutes(
      [{ path: '/o/:orgSlug/messages', element: <PortalMessages /> }],
      '/o/bright-minds/messages',
      asParent,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Lesson moved/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Lesson moved' });
    expect(within(dialog).getByText(/See you then/)).toBeVisible();
    expect(within(dialog).getByText('Bright Minds Tuition · Today')).toBeVisible();
  });
});
