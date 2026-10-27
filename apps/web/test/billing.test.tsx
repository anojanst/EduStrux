import { addDays, localNow } from '@edustrux/shared/dates';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { InvoicePage } from '../src/pages/billing/InvoicePage';
import { InvoicesPage } from '../src/pages/billing/InvoicesPage';
import { PaymentsPage } from '../src/pages/billing/PaymentsPage';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Billing (TUI-119): the invoices list, an invoice, invoice runs, recording and deleting payments.

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
const NZD = (amount: number) => ({ amount, currency: 'NZD' });
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });

const routes = [
  {
    path: '/o/:orgSlug/invoices',
    element: (
      <>
        <InvoicesPage />
        <Where />
      </>
    ),
  },
  { path: '/o/:orgSlug/invoices/:invoiceId', element: <InvoicePage /> },
  { path: '/o/:orgSlug/payments', element: <PaymentsPage /> },
];

const term = {
  id: 'trm_4',
  academicYearId: 'acy',
  name: 'Term 4',
  startDate: addDays(today, -14),
  endDate: addDays(today, 56),
  createdAt: at,
  updatedAt: at,
};
const lookups = {
  [`${API}/terms?limit=200`]: page([term]),
  [`${API}/branches?limit=200`]: page([{ id: 'brn_main', name: 'Main', address: null }]),
  [`${API}/families?limit=200`]: page([]),
};

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inl_1',
    enrolmentId: 'enr_1',
    studentId: 'stu_amaya',
    studentFirstName: 'Amaya',
    studentLastName: 'Perera',
    classId: 'cls_y9m',
    className: 'Year 9 Maths',
    courseId: 'crs',
    basis: 'per_lesson',
    unitPrice: NZD(3500),
    quantity: 8,
    lessons: 8,
    periodLessons: 8,
    freeLessons: 0,
    priceSource: 'course',
    priceRuleId: null,
    priceOverridden: false,
    taxRateId: 'tax_gst',
    taxName: 'GST',
    taxRateBps: 1500,
    taxInclusive: false,
    discount: NZD(0),
    discounts: [],
    subtotal: NZD(28000),
    tax: NZD(4200),
    total: NZD(32200),
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    familyId: 'fam_perera',
    familyName: 'Perera',
    branchId: 'brn_main',
    status: 'issued',
    number: 'INV-0007',
    termId: 'trm_4',
    month: null,
    periodStart: term.startDate,
    periodEnd: term.endDate,
    bankReference: '7K2M9QXA',
    dueDate: addDays(today, 10),
    notes: null,
    subtotal: NZD(28000),
    tax: NZD(4200),
    total: NZD(32200),
    paid: NZD(0),
    balance: NZD(32200),
    lines: [line()],
    issuedAt: at,
    voidedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const overdue = invoice({
  id: 'inv_old',
  number: 'INV-0003',
  dueDate: addDays(today, -6),
  bankReference: 'OLD12345',
});
const draft = invoice({
  id: 'inv_draft',
  familyId: 'fam_lee',
  familyName: 'Lee',
  status: 'draft',
  number: null,
  bankReference: 'DRAFT001',
  issuedAt: null,
  lines: [line({ studentId: 'stu_ben', studentFirstName: 'Ben', studentLastName: 'Lee' })],
});
const draft2 = { ...draft, id: 'inv_draft2', familyId: 'fam_ali', familyName: 'Ali' };
const paidInvoice = invoice({
  id: 'inv_paid',
  familyId: 'fam_ngata',
  familyName: 'Ngata',
  status: 'paid',
  paid: NZD(32200),
  balance: NZD(0),
});

describe('the invoices list', () => {
  it('shows each invoice with its family, period, reference, balance and status', async () => {
    stubApi({
      ...lookups,
      [`${API}/invoices?limit=50`]: page([overdue, paidInvoice, draft]),
      [`${API}/reports/dashboard`]: {
        body: {
          money: {
            owing: NZD(842000),
            overdue: NZD(126000),
            overdueInvoices: 6,
            receivedThisMonth: NZD(598000),
            draftInvoices: 12,
          },
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('owner'));

    const row = (await screen.findByText('Perera family')).closest('a')!;
    expect(row).toHaveAttribute('href', '/o/bright-minds/invoices/inv_old');
    expect(within(row).getByText('Overdue')).toBeVisible();
    expect(within(row).getAllByText('Term 4')[0]).toBeInTheDocument();
    expect(within(row).getByText('INV-0003')).toBeVisible();
    expect(within(screen.getByText('Ngata family').closest('a')!).getByText('Paid')).toBeVisible();
    expect(within(screen.getByText('Lee family').closest('a')!).getByText('Draft')).toBeVisible();
    expect(await screen.findByText('$8,420.00')).toBeVisible();
    expect(screen.getByText('6 invoices')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run invoices' })).toBeVisible();
  });

  it('filters by status through the API', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices?limit=50`]: page([overdue, draft]),
      [`${API}/invoices?limit=50&status=draft`]: page([draft]),
      [`${API}/reports/dashboard`]: { body: {} },
    });
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('owner'));
    await screen.findByText('Perera family');
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(screen.queryByText('Perera family')).toBeNull());
    expect(screen.getByText('Lee family')).toBeVisible();
    expect(calls.some((c) => c.key === `${API}/invoices?limit=50&status=draft`)).toBe(true);
    expect(screen.getByTestId('where')).toHaveTextContent('?status=draft');
  });

  it('issues the drafts chosen, one after another, each with its own key', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices?limit=50`]: page([draft, draft2, overdue]),
      [`${API}/reports/dashboard`]: { body: {} },
      'POST /api/v1/orgs/org_1/invoices/inv_draft/issue': { body: { ...draft, status: 'issued' } },
      'POST /api/v1/orgs/org_1/invoices/inv_draft2/issue': {
        body: { ...draft2, status: 'issued' },
      },
    });
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('owner'));
    await screen.findByText('Lee family');
    // Only drafts can be chosen.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await userEvent.click(screen.getByRole('checkbox', { name: /Lee family/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Ali family/ }));
    expect(screen.getByText('2 drafts selected · $644.00')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Issue 2 invoices' }));
    const dialog = await screen.findByRole('dialog', { name: 'Issue 2 invoices?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue 2 invoices' }));

    expect(await screen.findByText('2 invoices issued')).toBeVisible();
    const issued = calls.filter((c) => c.key.endsWith('/issue'));
    expect(issued.map((c) => c.key)).toEqual([
      'POST /api/v1/orgs/org_1/invoices/inv_draft/issue',
      'POST /api/v1/orgs/org_1/invoices/inv_draft2/issue',
    ]);
    expect(issued[0]!.headers['Idempotency-Key']).toBe(`issue-inv_draft-${at}`);
  });

  it('lets the accountant read, without running, issuing or taking payments', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices?limit=50`]: page([draft, overdue]),
    });
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('accountant'));
    await screen.findByText('Lee family');
    expect(screen.queryByRole('button', { name: 'Run invoices' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    // The accountant can't read reports or families, so the page doesn't ask.
    expect(calls.some((c) => c.key.includes('/reports/dashboard'))).toBe(false);
    expect(calls.some((c) => c.key.includes('/families'))).toBe(false);
  });

  it('is not for teachers or parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('teacher'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('an invoice', () => {
  const termLine = line({
    basis: 'per_term',
    unitPrice: NZD(28000),
    quantity: 1,
    lessons: 6,
    periodLessons: 8,
    discount: NZD(1000),
    discounts: [{ ruleId: 'dr_sib', name: 'Sibling discount', amount: NZD(1000) }],
    subtotal: NZD(20000),
    tax: NZD(3000),
    total: NZD(23000),
  });
  const partPaid = invoice({
    id: 'inv_1',
    status: 'part_paid',
    dueDate: addDays(today, -6),
    lines: [
      termLine,
      line({
        id: 'inl_2',
        studentId: 'stu_kavi',
        studentFirstName: 'Kavi',
        className: 'Year 7 English',
        freeLessons: 2,
      }),
    ],
    subtotal: NZD(48000),
    tax: NZD(7200),
    total: NZD(55200),
    paid: NZD(10000),
    balance: NZD(45200),
  });
  const payment = {
    id: 'pay_1',
    familyId: 'fam_perera',
    familyName: 'Perera',
    branchId: 'brn_main',
    method: 'bank_transfer',
    amount: NZD(10000),
    receivedOn: addDays(today, -3),
    reference: 'PERERA-T4',
    notes: null,
    allocations: [{ invoiceId: 'inv_1', amount: NZD(10000) }],
    createdAt: at,
    updatedAt: at,
  };

  it('shows its lines by student, discounts, tax, totals and payments', async () => {
    stubApi({
      ...lookups,
      [`${API}/invoices/inv_1`]: { body: partPaid },
      [`${API}/payments?invoiceId=inv_1&limit=200`]: page([payment]),
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));

    expect(await screen.findByRole('heading', { name: /Perera family/ })).toBeVisible();
    expect(screen.getByText('6 of 8 lessons · term price $280.00')).toBeVisible();
    expect(screen.getByText('Sibling discount')).toBeVisible();
    expect(screen.getByText('−$10.00')).toBeVisible();
    expect(screen.getByText('8 lessons × $35.00 · 2 free trial lessons not charged')).toBeVisible();
    expect(screen.getByText('GST 15%')).toBeVisible();
    expect(screen.getByText('$552.00')).toBeVisible();
    expect(screen.getByText('$452.00')).toBeVisible();
    expect(screen.getByText('Overdue by 6 days')).toBeVisible();
    expect(await screen.findByText('Ref PERERA-T4')).toBeVisible();
  });

  it('hides Void once a payment is on it', async () => {
    stubApi({
      ...lookups,
      [`${API}/invoices/inv_1`]: { body: partPaid },
      [`${API}/payments?invoiceId=inv_1&limit=200`]: page([payment]),
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'More invoice actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Edit due date and note' })).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: 'Void invoice' })).toBeNull();
  });

  it('voids a draft after saying what happens', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices/inv_draft`]: { body: draft },
      [`${API}/payments?invoiceId=inv_draft&limit=200`]: page([]),
      'POST /api/v1/orgs/org_1/invoices/inv_draft/void': { body: { ...draft, status: 'void' } },
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_draft', inOrg('owner'));
    expect((await screen.findAllByRole('button', { name: 'Issue invoice' }))[0]).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'More invoice actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Void invoice' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Void this invoice for the Lee family?',
    });
    expect(within(dialog).getByText(/Its enrolments can then be invoiced again/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void invoice' }));
    expect(await screen.findByText('Invoice voided')).toBeVisible();
    expect(calls.some((c) => c.key === 'POST /api/v1/orgs/org_1/invoices/inv_draft/void')).toBe(
      true,
    );
  });

  it('edits the due date and note, and says when someone else saved first', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices/inv_1`]: { body: invoice() },
      [`${API}/payments?invoiceId=inv_1&limit=200`]: page([]),
      'PATCH /api/v1/orgs/org_1/invoices/inv_1': {
        status: 409,
        body: { error: { code: 'stale_data', message: 'Changed' } },
      },
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'More invoice actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit due date and note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit invoice' });
    await userEvent.clear(within(dialog).getByLabelText('Due date'));
    await userEvent.type(within(dialog).getByLabelText('Note to the family'), 'Thanks!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText(/Someone else changed this/)).toBeVisible();
    const sent = calls.find((c) => c.key.startsWith('PATCH'))!;
    expect(sent.body).toEqual({ updatedAt: at, dueDate: null, notes: 'Thanks!' });
  });

  it('is read-only for the accountant', async () => {
    stubApi({
      ...lookups,
      [`${API}/invoices/inv_1`]: { body: invoice() },
      [`${API}/payments?invoiceId=inv_1&limit=200`]: page([]),
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('accountant'));
    await screen.findByRole('heading', { name: /Perera family/ });
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More invoice actions' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Download PDF' })[0]).toBeInTheDocument();
  });

  it('says so when PDFs aren’t set up', async () => {
    stubApi({
      ...lookups,
      [`${API}/invoices/inv_paid`]: { body: paidInvoice },
      [`${API}/payments?invoiceId=inv_paid&limit=200`]: page([]),
      [`${API}/invoices/inv_paid/pdf`]: {
        status: 503,
        body: { error: { code: 'unavailable', message: 'No Browser Rendering' } },
      },
    });
    const tab = { close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderRoutes(routes, '/o/bright-minds/invoices/inv_paid', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Download PDF' }))[0]!);
    expect(
      await screen.findByText('PDFs aren’t available yet: print the page instead.'),
    ).toBeVisible();
    expect(tab.close).toHaveBeenCalled();
  });
});

describe('recording a payment', () => {
  const open = invoice({ id: 'inv_1', balance: NZD(45200) });
  const older = invoice({
    id: 'inv_old',
    number: 'INV-0003',
    bankReference: 'OLD12345',
    dueDate: addDays(today, -30),
    balance: NZD(32200),
  });
  const replies = {
    ...lookups,
    [`${API}/invoices/inv_1`]: { body: open },
    [`${API}/payments?invoiceId=inv_1&limit=200`]: page([]),
    [`${API}/invoices?status=issued&familyId=fam_perera&limit=200`]: page([open, older]),
    [`${API}/invoices?status=part_paid&familyId=fam_perera&limit=200`]: page([]),
  };

  async function openDialog() {
    await userEvent.click((await screen.findAllByRole('button', { name: 'Record payment' }))[0]!);
    return screen.findByRole('dialog', { name: 'Record payment' });
  }

  it('starts on the invoice it was opened from, and spreads more over the older ones', async () => {
    stubApi(replies);
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('front_desk'));
    const dialog = await openDialog();
    const amount = await within(dialog).findByLabelText('Amount (required)');
    expect(amount).toHaveValue('452.00');
    const first = within(dialog).getByLabelText('Amount for INV-0007 · Term 4');
    const second = within(dialog).getByLabelText('Amount for INV-0003 · Term 4');
    expect(first).toHaveValue('452.00');
    expect(second).toHaveValue('');

    await userEvent.clear(amount);
    await userEvent.type(amount, '600');
    expect(first).toHaveValue('452.00');
    expect(second).toHaveValue('148.00');
    expect(within(dialog).getByText('Allocated $600.00 of $600.00')).toBeVisible();
  });

  it('refuses more than the family owes, before sending anything', async () => {
    const calls = stubApi(replies);
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));
    const dialog = await openDialog();
    const amount = await within(dialog).findByLabelText('Amount (required)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '900');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(within(dialog).getByText('The Perera family owes $774.00.')).toBeVisible();
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('refuses amounts on the invoices that don’t add up to the payment', async () => {
    const calls = stubApi(replies);
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));
    const dialog = await openDialog();
    const first = await within(dialog).findByLabelText('Amount for INV-0007 · Term 4');
    await userEvent.clear(first);
    await userEvent.type(first, '100');
    expect(within(dialog).getByText(/\$352\.00 left to allocate/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      within(dialog).getByText('The amounts for the invoices must add up to the payment.'),
    ).toBeVisible();
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('records it once, with what goes to each invoice', async () => {
    const calls = stubApi({
      ...replies,
      'POST /api/v1/orgs/org_1/payments': {
        status: 201,
        body: {
          id: 'pay_new',
          familyId: 'fam_perera',
          familyName: 'Perera',
          branchId: 'brn_main',
          method: 'cash',
          amount: NZD(60000),
          receivedOn: today,
          reference: null,
          notes: null,
          allocations: [],
          createdAt: at,
          updatedAt: at,
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/invoices/inv_1', inOrg('owner'));
    const dialog = await openDialog();
    const amount = await within(dialog).findByLabelText('Amount (required)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '600');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Cash' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(
      await screen.findByText('Payment of $600.00 recorded for the Perera family'),
    ).toBeVisible();
    const sent = calls.find((c) => c.key === 'POST /api/v1/orgs/org_1/payments')!;
    expect(sent.body).toEqual({
      familyId: 'fam_perera',
      method: 'cash',
      amount: NZD(60000),
      receivedOn: today,
      reference: null,
      notes: null,
      allocations: [
        { invoiceId: 'inv_1', amount: NZD(45200) },
        { invoiceId: 'inv_old', amount: NZD(14800) },
      ],
    });
    expect(sent.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('running invoices', () => {
  it('starts a term run, follows the job and shows what it made and left off', async () => {
    let polls = 0;
    const calls = stubApi({
      ...lookups,
      [`${API}/invoices?limit=50`]: page([]),
      [`${API}/reports/dashboard`]: { body: {} },
      'POST /api/v1/orgs/org_1/terms/trm_4/generate-invoices': {
        status: 202,
        body: { jobId: 'job_1' },
      },
      [`${API}/jobs/job_1`]: () => {
        polls += 1;
        return {
          body: {
            id: 'job_1',
            type: 'invoices.generate',
            status: polls < 2 ? 'running' : 'succeeded',
            progress: polls < 2 ? 40 : 100,
            attempts: 1,
            error: null,
            createdAt: at,
            updatedAt: at,
            result:
              polls < 2
                ? null
                : {
                    termId: 'trm_4',
                    month: null,
                    periodStart: term.startDate,
                    periodEnd: term.endDate,
                    invoices: 12,
                    lines: 31,
                    total: NZD(564000),
                    alreadyInvoiced: 4,
                    skipped: [
                      {
                        enrolmentId: 'enr_aria',
                        studentId: 'stu_aria',
                        classId: 'cls_y9m',
                        reason: 'no_price',
                      },
                    ],
                  },
          },
        };
      },
      [`${API}/enrolments?classId=cls_y9m&limit=200`]: page([
        {
          id: 'enr_aria',
          studentId: 'stu_aria',
          studentFirstName: 'Aria',
          studentLastName: 'Perera',
          classId: 'cls_y9m',
          className: 'Year 9 Maths',
        },
      ]),
    });
    renderRoutes(routes, '/o/bright-minds/invoices', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Run invoices' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Run invoices' });
    await userEvent.type(within(dialog).getByLabelText('Due date'), addDays(today, 14));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make drafts' }));

    expect(await within(dialog).findByText('Making drafts for Term 4…')).toBeVisible();
    expect(
      await within(dialog).findByText('12 draft invoices made', {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(within(dialog).getByText('$5,640.00 · 31 lines')).toBeVisible();
    expect(
      within(dialog).getByText('4 enrolments were already invoiced for this term.'),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Left off (1)' }));
    expect(await within(dialog).findByText('Aria Perera')).toBeVisible();
    expect(within(dialog).getByText('No price set')).toBeVisible();

    const started = calls.find((c) => c.key.endsWith('/generate-invoices'))!;
    expect(started.body).toEqual({ dueDate: addDays(today, 14) });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review drafts' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/o/bright-minds/invoices?status=draft');
  });
});

describe('the payments list', () => {
  const payments = [
    {
      id: 'pay_1',
      familyId: 'fam_perera',
      familyName: 'Perera',
      branchId: 'brn_main',
      method: 'bank_transfer',
      amount: NZD(45000),
      receivedOn: addDays(today, -2),
      reference: 'PERERA-T4',
      notes: null,
      allocations: [{ invoiceId: 'inv_1', invoiceNumber: 'INV-0007', amount: NZD(45000) }],
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'pay_2',
      familyId: 'fam_chen',
      familyName: 'Chen',
      branchId: 'brn_main',
      method: 'cash',
      amount: NZD(73000),
      receivedOn: addDays(today, -4),
      reference: null,
      notes: null,
      allocations: [
        { invoiceId: 'inv_a', invoiceNumber: 'INV-0004', amount: NZD(40000) },
        { invoiceId: 'inv_b', invoiceNumber: 'INV-0005', amount: NZD(33000) },
      ],
      createdAt: at,
      updatedAt: at,
    },
  ];
  const replies = {
    ...lookups,
    [`${API}/payments?limit=50`]: page(payments),
    [`${API}/payments?limit=50&method=cash`]: page([payments[1]]),
  };

  it('shows who paid, how, and what it paid towards', async () => {
    stubApi(replies);
    renderRoutes(routes, '/o/bright-minds/payments', inOrg('owner'));
    const row = (await screen.findByText('Perera family')).closest('li')!;
    expect(within(row).getByText('$450.00')).toBeVisible();
    expect(within(row).getByText('PERERA-T4')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'INV-0007' })).toHaveAttribute(
      'href',
      '/o/bright-minds/invoices/inv_1',
    );
    const chen = screen.getByText('Chen family').closest('li')!;
    expect(within(chen).getByRole('link', { name: 'INV-0004' })).toBeInTheDocument();
    expect(within(chen).getByRole('link', { name: 'INV-0005' })).toBeInTheDocument();

    // The method filter is the API's, so it covers every payment, not just the page loaded.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Method' }), 'cash');
    await waitFor(() => expect(screen.queryByText('Perera family')).toBeNull());
    expect(screen.getByText('Chen family')).toBeVisible();
  });

  it('deletes a payment recorded by mistake', async () => {
    const calls = stubApi({
      ...replies,
      'DELETE /api/v1/orgs/org_1/payments/pay_1': { status: 204 },
    });
    renderRoutes(routes, '/o/bright-minds/payments', inOrg('branch_manager'));
    await screen.findByText('Perera family');
    await userEvent.click(screen.getAllByRole('button', { name: 'Payment actions' })[0]!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this payment?' });
    expect(
      within(dialog).getByText(
        'The $450.00 payment from the Perera family comes off. The invoices it paid go back to owing.',
      ),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete payment' }));
    expect(await screen.findByText('Payment deleted')).toBeVisible();
    expect(calls.some((c) => c.key === 'DELETE /api/v1/orgs/org_1/payments/pay_1')).toBe(true);
  });

  it('gives the accountant receipts but no delete', async () => {
    stubApi(replies);
    renderRoutes(routes, '/o/bright-minds/payments', inOrg('accountant'));
    await screen.findByText('Perera family');
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Payment actions' })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Download receipt' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Delete payment' })).toBeNull();
  });
});
