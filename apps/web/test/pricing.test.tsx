import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { PricingPage } from '../src/pages/settings/PricingPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Pricing (TUI-123): prices, discounts and tax rates.

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'o@example.com', name: 'Olivia Hart', memberships: [] },
        membership: { id: 'mem_me', role, branchIds: null, org },
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
const NZD = (amount: number) => ({ amount, currency: 'NZD' });
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const routes = [{ path: '/o/:orgSlug/settings/pricing', element: <PricingPage /> }];
const PATH = '/o/bright-minds/settings/pricing';

const gst = {
  id: 'txr_gst',
  name: 'GST',
  rateBps: 1500,
  inclusive: true,
  isDefault: true,
  createdAt: at,
  updatedAt: at,
};
const rule = (overrides: Record<string, unknown>) => ({
  id: 'prr_1',
  courseId: null,
  classId: null,
  basis: 'per_term',
  price: NZD(45000),
  packLessons: null,
  freeTrialLessons: 0,
  taxRateId: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});
const everyClass = rule({ id: 'prr_org', freeTrialLessons: 1 });
const courseRule = rule({
  id: 'prr_course',
  courseId: 'crs_y9m',
  basis: 'per_lesson',
  price: NZD(3500),
});
const classRule = rule({
  id: 'prr_class',
  classId: 'cls_a',
  basis: 'pack',
  price: NZD(30000),
  packLessons: 10,
  taxRateId: 'txr_gst',
});
const sibling = {
  id: 'dsr_1',
  name: 'Sibling discount',
  kind: 'sibling',
  percentBps: 1000,
  amount: null,
  fixedPrice: null,
  minCount: 2,
  courseIds: null,
  studentIds: null,
  familyIds: null,
  cutoffDate: null,
  termId: null,
  startsOn: null,
  endsOn: null,
  active: true,
  createdAt: at,
  updatedAt: at,
};

const lookups = {
  [`${API}/tax-rates?limit=200`]: page([gst]),
  [`${API}/price-rules?limit=200`]: page([everyClass, courseRule, classRule]),
  [`${API}/discount-rules?limit=200`]: page([sibling]),
  [`${API}/courses?limit=200`]: page([
    {
      id: 'crs_y9m',
      subjectId: 'sbj_maths',
      gradeLevelId: 'grd_9',
      curriculum: null,
      teachingMedium: null,
      defaultPrice: null,
      durationMinutes: 60,
      createdAt: at,
      updatedAt: at,
    },
  ]),
  [`${API}/subjects?limit=200`]: page([{ id: 'sbj_maths', name: 'Maths' }]),
  [`${API}/grade-levels`]: page([{ id: 'grd_9', name: 'Year 9', sortOrder: 1 }]),
  [`${API}/classes?limit=200`]: page([
    { id: 'cls_a', name: 'Group A', courseId: 'crs_y9m', branchId: 'brn_main' },
  ]),
  [`${API}/terms?limit=200`]: page([]),
};

describe('prices', () => {
  it('lists every class’s, the courses’ and the classes’ prices with how they are charged', async () => {
    stubApi(lookups);
    renderRoutes(routes, PATH, inOrg('owner'));
    const every = (await screen.findByText('Every class', { selector: 'b' })).closest('li')!;
    expect(within(every).getByText('$450.00 per term')).toBeVisible();
    expect(
      within(every).getByText('Per term · 1 free trial lesson · GST 15% (default)'),
    ).toBeVisible();
    const course = screen.getByText('Year 9 Maths').closest('li')!;
    expect(within(course).getByText('$35.00 per lesson')).toBeVisible();
    const klass = (await screen.findByText('Group A')).closest('li')!;
    expect(within(klass).getByText('$300.00 for 10 lessons')).toBeVisible();
    expect(within(klass).getByText('Lesson pack · GST 15%')).toBeVisible();
  });

  it('adds a course price', async () => {
    const calls = stubApi({
      ...lookups,
      'POST /api/v1/orgs/org_1/price-rules': { status: 201, body: courseRule },
    });
    renderRoutes(routes, PATH, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add price' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add price' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Course/), 'crs_y9m');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Charged/), 'per_lesson');
    await userEvent.type(within(dialog).getByLabelText(/^Price/), '35');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add price' }));

    expect(await screen.findByText('Price added')).toBeVisible();
    const sent = calls.find((c) => c.key === 'POST /api/v1/orgs/org_1/price-rules')!;
    expect(sent.body).toEqual({
      courseId: 'crs_y9m',
      basis: 'per_lesson',
      price: NZD(3500),
      freeTrialLessons: 0,
      taxRateId: null,
    });
  });

  it('asks for a pack’s size and checks the numbers before sending', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, PATH, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add price' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add price' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Charged/), 'pack');
    await userEvent.clear(within(dialog).getByLabelText(/^Lessons in a pack/));
    await userEvent.type(within(dialog).getByLabelText(/^Lessons in a pack/), '1');
    await userEvent.type(within(dialog).getByLabelText(/^Price/), 'abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add price' }));
    expect(within(dialog).getByText('A pack holds 2 to 200 lessons.')).toBeVisible();
    expect(within(dialog).getByText('Enter an amount, like 45.00.')).toBeVisible();
    expect(within(dialog).getByText('This is required.')).toBeVisible(); // the course
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('only changes the price of an existing rule, not what it prices', async () => {
    const calls = stubApi({
      ...lookups,
      'PATCH /api/v1/orgs/org_1/price-rules/prr_class': { body: classRule },
    });
    renderRoutes(routes, PATH, inOrg('owner'));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Actions for the price of Group A' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit price' });
    expect(within(dialog).queryByLabelText(/^Charged/)).toBeNull();
    const price = within(dialog).getByLabelText(/^Price/);
    expect(price).toHaveValue('300.00');
    await userEvent.clear(price);
    await userEvent.type(price, '320');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Price saved');
    expect(calls.find((c) => c.key.startsWith('PATCH'))!.body).toEqual({
      updatedAt: at,
      price: NZD(32000),
      packLessons: 10,
      freeTrialLessons: 0,
      taxRateId: 'txr_gst',
    });
  });

  it('lets branch staff price only their classes', async () => {
    stubApi(lookups);
    renderRoutes(routes, PATH, inOrg('branch_manager'));
    await screen.findByText('Group A');
    // Org-wide and course prices are the owner's.
    expect(
      screen.queryByRole('button', { name: 'Actions for the price of Every class' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Actions for the price of Year 9 Maths' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for the price of Group A' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Add price' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add price' });
    expect(within(dialog).queryByText('Applies to')).toBeNull();
    expect(within(dialog).getByLabelText(/^Class/)).toBeInTheDocument();
  });

  it('is read-only for the accountant, and not for teachers', async () => {
    stubApi(lookups);
    const view = renderRoutes(routes, PATH, inOrg('accountant'));
    await screen.findByText('$450.00 per term');
    expect(screen.queryByRole('button', { name: 'Add price' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    view.unmount();
    renderRoutes(routes, PATH, inOrg('teacher'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('tax rates', () => {
  it('adds a rate from a percentage', async () => {
    const calls = stubApi({
      ...lookups,
      'POST /api/v1/orgs/org_1/tax-rates': {
        status: 201,
        body: { ...gst, id: 'txr_vat', name: 'VAT', rateBps: 1250, isDefault: false },
      },
    });
    renderRoutes(routes, `${PATH}?tab=tax`, inOrg('owner'));
    expect((await screen.findByText('GST')).closest('li')).toHaveTextContent('Default');
    await userEvent.click(screen.getByRole('button', { name: 'Add tax rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add tax rate' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'VAT');
    await userEvent.type(within(dialog).getByLabelText(/^Rate/), '12.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tax rate' }));
    await screen.findByText('Tax rate added');
    expect(calls.find((c) => c.key.startsWith('POST'))!.body).toEqual({
      name: 'VAT',
      rateBps: 1250,
      inclusive: true,
      isDefault: false,
    });
  });

  it('says why a rate in use can’t be deleted', async () => {
    stubApi({
      ...lookups,
      'DELETE /api/v1/orgs/org_1/tax-rates/txr_gst': {
        status: 422,
        body: {
          error: { code: 'unprocessable', message: 'A price rule still uses this tax rate.' },
        },
      },
    });
    renderRoutes(routes, `${PATH}?tab=tax`, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for GST' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete GST?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText('A price rule still uses this tax rate.')).toBeVisible();
  });

  it('can’t be changed by branch staff', async () => {
    stubApi(lookups);
    renderRoutes(routes, `${PATH}?tab=tax`, inOrg('branch_manager'));
    await screen.findByText('GST');
    expect(screen.queryByRole('button', { name: 'Add tax rate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for GST' })).toBeNull();
  });
});

describe('discounts', () => {
  it('lists each discount with what it takes off and who gets it', async () => {
    stubApi(lookups);
    renderRoutes(routes, `${PATH}?tab=discounts`, inOrg('front_desk'));
    const row = (await screen.findByText('Sibling discount', { selector: 'b' })).closest('li')!;
    expect(within(row).getByText('10% off')).toBeVisible();
    expect(
      within(row).getByText('Sibling discount · Families with 2 or more children billed'),
    ).toBeVisible();
    // Only the owner changes discounts (D-140).
    expect(screen.queryByRole('button', { name: 'Add discount' })).toBeNull();
  });

  it('adds a scholarship for the students chosen', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/students?limit=200`]: page([
        { id: 'stu_amaya', firstName: 'Amaya', lastName: 'Perera', familyId: 'fam_perera' },
        { id: 'stu_maia', firstName: 'Maia', lastName: 'Ngata', familyId: 'fam_ngata' },
      ]),
      [`${API}/families?limit=200`]: page([
        { id: 'fam_perera', name: 'Perera' },
        { id: 'fam_ngata', name: 'Ngata' },
      ]),
      'POST /api/v1/orgs/org_1/discount-rules': {
        status: 201,
        body: { ...sibling, id: 'dsr_2', kind: 'scholarship' },
      },
    });
    renderRoutes(routes, `${PATH}?tab=discounts`, inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add discount' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add discount' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Kind/), 'scholarship');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Merit award');
    await userEvent.type(within(dialog).getByLabelText(/^Percentage off/), '50');
    // None chosen yet: it says so before sending.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add discount' }));
    expect(within(dialog).getByText('Choose at least one.')).toBeVisible();

    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search Students' }), 'ama');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Amaya Perera/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add discount' }));
    await screen.findByText('Discount added');
    expect(calls.find((c) => c.key.startsWith('POST'))!.body).toEqual({
      kind: 'scholarship',
      name: 'Merit award',
      percentBps: 5000,
      amount: null,
      fixedPrice: null,
      studentIds: ['stu_amaya'],
      startsOn: null,
      endsOn: null,
      active: true,
    });
  });

  it('turns a discount off', async () => {
    const calls = stubApi({
      ...lookups,
      'PATCH /api/v1/orgs/org_1/discount-rules/dsr_1': { body: { ...sibling, active: false } },
    });
    renderRoutes(routes, `${PATH}?tab=discounts`, inOrg('owner'));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Actions for Sibling discount' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit discount' });
    expect(within(dialog).queryByLabelText(/^Kind/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('switch', { name: /^On/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(true));
    expect(calls.find((c) => c.key.startsWith('PATCH'))!.body).toMatchObject({
      updatedAt: at,
      name: 'Sibling discount',
      percentBps: 1000,
      minCount: 2,
      active: false,
    });
  });
});
