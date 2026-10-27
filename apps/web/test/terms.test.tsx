import { addDays, localNow } from '@edustrux/shared/dates';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { TermsPage } from '../src/pages/settings/TermsPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Terms & holidays (TUI-127): the owner sets the academic years, terms and holidays;
// staff see them.

const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Hart',
          memberships: [{ id: 'mem_me', role, branchIds: null, org: ref }],
        },
        membership: { id: 'mem_me', role, branchIds: null, org: ref },
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const ORG = '/api/v1/orgs/org_1';
const at = '2026-01-01T00:00:00.000Z';
const routes = [{ path: '/o/:orgSlug/settings/terms', element: <TermsPage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
// The page reads the dates against today, as the org (here the browser) sees it.
const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
const day = (n: number) => addDays(today, n);

const year = {
  id: 'acy_1',
  name: 'This year',
  startDate: day(-200),
  endDate: day(100),
  createdAt: at,
  updatedAt: at,
};
const term = (id: string, name: string, from: number, to: number) => ({
  id,
  academicYearId: 'acy_1',
  name,
  startDate: day(from),
  endDate: day(to),
  createdAt: at,
  updatedAt: at,
});
const t1 = term('trm_1', 'Term 1', -180, -110);
const t2 = term('trm_2', 'Term 2', -20, 30);
const t3 = term('trm_3', 'Term 3', 50, 90);
const holiday = (id: string, name: string, from: number, to: number, branchId: string | null) => ({
  id,
  name,
  startDate: day(from),
  endDate: day(to),
  branchId,
  createdAt: at,
  updatedAt: at,
});
const lookups = {
  [`${API}/academic-years?limit=200`]: page([year]),
  [`${API}/terms?limit=200`]: page([t3, t1, t2]),
  [`${API}/holidays?limit=200`]: page([
    holiday('hol_1', 'Easter', -150, -147, null),
    holiday('hol_2', 'Anniversary Day', 40, 40, 'brn_a'),
  ]),
  [`${API}/branches?limit=200`]: page([
    { id: 'brn_a', name: 'Albany' },
    { id: 'brn_c', name: 'City' },
  ]),
  [`${API}/classes?limit=200`]: page([
    { id: 'cls_1', name: 'Year 9 Maths', branchId: 'brn_a', termId: 'trm_2' },
    { id: 'cls_2', name: 'Year 7 English', branchId: 'brn_a', termId: 'trm_2' },
  ]),
};
const rowOf = (name: string) => screen.getByText(name).closest('li')!;

describe('the terms and holidays', () => {
  it('shows the year, its terms with where each is at, and the holidays', async () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('owner'));

    expect(await screen.findByText('This year · 3 terms · 2 holidays')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Academic year This year' })).toBeVisible();
    expect(screen.getByText('Current')).toBeVisible();
    expect(within(rowOf('Term 1')).getByText('Finished')).toBeVisible();
    expect(within(rowOf('Term 2')).getByText('Now · Week 3 of 7')).toBeVisible();
    expect(within(rowOf('Term 2')).getAllByText(/2 classes/)[0]).toBeInTheDocument();
    expect(within(rowOf('Term 3')).getByText('Upcoming · Starts in 7 weeks')).toBeVisible();
    // Invoices are run for the next term to start.
    expect(within(rowOf('Term 3')).getByRole('button', { name: 'Run invoices' })).toBeVisible();
    expect(within(rowOf('Easter')).getByText('All branches')).toBeVisible();
    expect(await within(rowOf('Anniversary Day')).findByText('Albany only')).toBeVisible();
  });

  it('is read-only for other staff', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('front_desk'));
    expect(await screen.findByText('Only the owner can change terms and holidays.')).toBeVisible();
    await screen.findByText('Term 2');
    expect(screen.queryByRole('button', { name: 'Add term' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add holiday' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Term 2' })).toBeNull();
    expect(calls.some((c) => !c.key.startsWith('GET'))).toBe(false);
  });

  it('is not for parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('changing them', () => {
  it('adds a term, checking it against the other terms first', async () => {
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/terms`]: { status: 201, body: term('trm_4', 'Term 4', 92, 99) },
    });
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add term' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add term' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Term 4');
    fireEvent.change(within(dialog).getByLabelText(/^Start date/), {
      target: { value: day(85) },
    });
    fireEvent.change(within(dialog).getByLabelText(/^End date/), { target: { value: day(99) } });
    expect(within(dialog).getByText(/^Overlaps Term 3/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add term' }));
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/^Start date/), {
      target: { value: day(92) },
    });
    expect(within(dialog).getByText(/^1 week · /)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add term' }));
    expect(await screen.findByText('Term added')).toBeVisible();
    expect(calls.find((c) => c.key === `POST ${ORG}/terms`)?.body).toEqual({
      academicYearId: 'acy_1',
      name: 'Term 4',
      startDate: day(92),
      endDate: day(99),
    });
  });

  it('lists the classes that keep a term from being deleted', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Term 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete term' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete Term 2?' });
    expect(within(dialog).getByText('Term 2 is used by 2 classes:')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Year 9 Maths' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Delete term' })).toBeDisabled();
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });

  it('says which lessons a holiday removes, and adds it for one branch', async () => {
    const lesson = (id: string, className: string, date: string) => ({
      id,
      classId: id,
      className,
      branchId: 'brn_a',
      date,
      startTime: '16:00',
      endTime: '17:00',
      status: 'scheduled',
    });
    const calls = stubApi({
      ...lookups,
      [`${API}/sessions?from=${day(10)}&to=${day(11)}&branchId=brn_a&limit=200`]: page([
        lesson('ses_1', 'Year 9 Maths', day(10)),
        lesson('ses_2', 'Year 7 English', day(11)),
        lesson('ses_3', 'Year 8 Science', day(11)),
        { ...lesson('ses_4', 'Year 10 Maths', day(11)), status: 'cancelled' },
      ]),
      [`POST ${ORG}/holidays`]: {
        status: 201,
        body: holiday('hol_3', 'Teacher only days', 10, 11, 'brn_a'),
      },
    });
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add holiday' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add holiday' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Teacher only days');
    fireEvent.change(within(dialog).getByLabelText(/^From/), { target: { value: day(10) } });
    fireEvent.change(within(dialog).getByLabelText(/^To/), { target: { value: day(11) } });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Albany/ }));

    expect(
      await within(dialog).findByText('3 lessons on these days will be removed'),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/^Year 9 Maths \(.+\), Year 7 English \(.+\) and 1 more\.$/),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add holiday' }));
    expect(await screen.findByText('Holiday added')).toBeVisible();
    expect(calls.find((c) => c.key === `POST ${ORG}/holidays`)?.body).toEqual({
      name: 'Teacher only days',
      startDate: day(10),
      endDate: day(11),
      branchId: 'brn_a',
    });
  });

  it('shows why the API refused a change to the year', async () => {
    stubApi({
      ...lookups,
      [`PATCH ${ORG}/academic-years/acy_1`]: {
        status: 422,
        body: {
          error: {
            code: 'unprocessable',
            message: 'Term 3 would fall outside these dates.',
          },
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/settings/terms', inOrg('owner'));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit academic year This year' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit academic year' });
    fireEvent.change(within(dialog).getByLabelText(/^End date/), { target: { value: day(60) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Term 3 would fall outside these dates.')).toBeVisible();
  });
});
