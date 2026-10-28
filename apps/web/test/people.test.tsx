import { screen, waitFor, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { AppShell } from '../src/layouts/AppShell';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { FamilyPage } from '../src/pages/people/FamilyPage';
import { PeoplePage } from '../src/pages/people/PeoplePage';
import { StudentPage } from '../src/pages/people/StudentPage';
import { resetAccount } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner', branchIds: string[] | null = null) =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Hart',
          memberships: [{ id: 'mem_me', role, branchIds, org }],
        },
        membership: { id: 'mem_me', role, branchIds, org },
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
const routes = [
  { path: '/o/:orgSlug/families', element: <PeoplePage /> },
  {
    path: '/o/:orgSlug/families/:familyId',
    element: (
      <>
        <FamilyPage />
        <Where />
      </>
    ),
  },
  { path: '/o/:orgSlug/students/:studentId', element: <StudentPage /> },
];

const branches = {
  data: [
    { id: 'brn_main', name: 'Main', address: null },
    { id: 'brn_albany', name: 'Albany', address: null },
  ],
  nextCursor: null,
};
const grades = {
  data: [
    { id: 'grd_7', name: 'Year 7', sortOrder: 1, createdAt: at, updatedAt: at },
    { id: 'grd_8', name: 'Year 8', sortOrder: 2, createdAt: at, updatedAt: at },
  ],
  nextCursor: null,
};
const years = {
  data: [
    {
      id: 'acy_26',
      name: '2026',
      startDate: '2026-01-26',
      endDate: '2026-12-18',
      createdAt: at,
      updatedAt: at,
    },
  ],
  nextCursor: null,
};

const mere = {
  id: 'gdn_mere',
  familyId: 'fam_perera',
  firstName: 'Mere',
  lastName: 'Perera',
  relationship: 'Mother',
  email: 'mere@example.co.nz',
  phone: '021 555 0142',
  preferredChannel: 'email',
  language: null,
  emergencyContact: true,
  membershipId: 'mem_mere',
  createdAt: at,
  updatedAt: at,
};
const nimal = {
  ...mere,
  id: 'gdn_nimal',
  firstName: 'Nimal',
  relationship: 'Father',
  email: 'nimal@example.co.nz',
  phone: null,
  emergencyContact: false,
  membershipId: null,
};
const aria = {
  id: 'stu_aria',
  familyId: 'fam_perera',
  familyName: 'Perera',
  branchId: 'brn_albany',
  firstName: 'Aria',
  lastName: 'Perera',
  dateOfBirth: '2013-03-09',
  notes: 'Works best near the front.',
  gradeLevelId: 'grd_7',
  grades: [{ academicYearId: 'acy_26', gradeLevelId: 'grd_7' }],
  createdAt: at,
  updatedAt: at,
};
const credit = (id: string, expiresOn: string | null) => ({
  id,
  studentId: 'stu_aria',
  studentFirstName: 'Aria',
  studentLastName: 'Perera',
  sessionId: 'ses_missed',
  classId: 'cls_maths',
  courseId: 'crs_maths',
  missedOn: '2026-10-01',
  expiresOn,
  status: 'available',
  booking: null,
  createdAt: at,
});
const perera = {
  id: 'fam_perera',
  name: 'Perera',
  branchId: 'brn_albany',
  address: '18 Kauri Road',
  billingGuardianId: 'gdn_mere',
  bankReference: '7K2M9QXA',
  guardians: [mere, nimal],
  students: [aria],
  createdAt: at,
  updatedAt: at,
};
const ngata = {
  ...perera,
  id: 'fam_ngata',
  name: 'Ngata',
  branchId: 'brn_main',
  billingGuardianId: null,
  bankReference: null,
  guardians: [],
  students: [],
};
const money = (amount: number) => ({ amount, currency: 'NZD' });
const invoice = (id: string, status: string, balance: number, dueDate: string | null) => ({
  id,
  familyId: 'fam_perera',
  familyName: 'Perera',
  branchId: 'brn_albany',
  status,
  termId: null,
  month: '2026-09',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  bankReference: '7K2M9QXA',
  dueDate,
  notes: null,
  subtotal: money(45000),
  tax: money(0),
  total: money(45000),
  paid: money(45000 - balance),
  balance: money(balance),
  lines: [],
  issuedAt: at,
  voidedAt: null,
  createdAt: `2026-09-0${id.length % 9}T00:00:00.000Z`,
  updatedAt: at,
});

const lookups = {
  [`${API}/branches?limit=200`]: { body: branches },
  [`${API}/grade-levels`]: { body: grades },
  [`${API}/academic-years?limit=200`]: { body: years },
};

beforeEach(() => resetAccount());

describe('the families list', () => {
  it('lists families with their contact, students, branch and portal state', async () => {
    stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [ngata, perera], nextCursor: null } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner'));

    const row = (await screen.findByText('Perera family')).closest('a')!;
    expect(row).toHaveAttribute('href', '/o/bright-minds/families/fam_perera');
    expect(within(row).getByText('1 student · 2 guardians')).toBeVisible();
    expect(within(row).getByText('Mere Perera')).toBeVisible();
    expect(within(row).getByText('Aria')).toBeVisible();
    expect(within(row).getByText('Albany')).toBeVisible();
    expect(within(row).getByText('Signed in')).toBeVisible();
    const empty = screen.getByText('Ngata family').closest('a')!;
    expect(within(empty).getByText('No guardian yet')).toBeVisible();
    expect(within(empty).getByText('Not signed in')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add family' })).toBeVisible();
  });

  it('filters by branch, and lists students by grade on the students tab', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [perera], nextCursor: null } },
      [`${API}/families?limit=50&branchId=brn_main`]: { body: { data: [], nextCursor: null } },
      [`${API}/students?limit=50`]: { body: { data: [aria], nextCursor: null } },
      [`${API}/students?limit=50&gradeLevelId=grd_8`]: { body: { data: [], nextCursor: null } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner'));
    await screen.findByText('Perera family');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Branch' }), 'brn_main');
    expect(await screen.findByText('Nothing matches these filters.')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Branch' }), '');

    await userEvent.click(screen.getByRole('tab', { name: 'Students' }));
    const row = (await screen.findByText('Aria Perera')).closest('a')!;
    expect(row).toHaveAttribute('href', '/o/bright-minds/students/stu_aria');
    expect(within(row).getAllByText('Perera family')[0]).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grade' }), 'grd_8');
    expect(await screen.findByText('Nothing matches these filters.')).toBeVisible();
    expect(calls.map((c) => c.key)).toContain(`${API}/students?limit=50&gradeLevelId=grd_8`);
  });

  it('searches as you type, and says when nothing matches', async () => {
    stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [perera], nextCursor: null } },
      [`${API}/search?q=per&limit=50`]: {
        body: {
          families: [
            { id: 'fam_perera', name: 'Perera', branchId: 'brn_albany', bankReference: '7K2M9QXA' },
          ],
          students: [],
          guardians: [],
        },
      },
      [`${API}/search?q=zz&limit=50`]: { body: { families: [], students: [], guardians: [] } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner'));
    await screen.findByText('Perera family');

    const box = screen.getByRole('searchbox', { name: 'Search families…' });
    await userEvent.type(box, 'per');
    expect(await screen.findByText('Albany · Bank reference 7K2M9QXA')).toBeVisible();
    await userEvent.clear(box);
    await userEvent.type(box, 'zz');
    expect(await screen.findByText('No results for “zz”')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('1 student · 2 guardians')).toBeVisible();
  });

  it('gives a teacher the list without the add button', async () => {
    stubApi({ ...lookups, [`${API}/families?limit=50`]: { body: { data: [], nextCursor: null } } });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('teacher'));
    expect(await screen.findByText('No families yet.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add family' })).toBeNull();
  });

  it('is not for parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/families', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('adding a family', () => {
  const POST = 'POST /api/v1/orgs/org_1';

  it('asks for what is required before sending anything', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [], nextCursor: null } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add family' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add family' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add family' }));

    expect(await within(dialog).findByText('Enter the family’s name.')).toBeVisible();
    expect(within(dialog).getByText('Choose a home branch.')).toBeVisible();
    expect(within(dialog).getAllByText('This is required.')).toHaveLength(2);
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('adds the family, its guardian and its students, then opens it', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [], nextCursor: null } },
      [`${API}/search/duplicates?kind=family&name=Fonoti`]: {
        body: {
          families: [
            {
              id: 'fam_old',
              name: 'Fonoti',
              branchId: 'brn_main',
              bankReference: null,
              reasons: ['same_name'],
            },
          ],
          students: [],
          guardians: [],
        },
      },
      [`${API}/search/duplicates?kind=guardian&email=losa%40example.co.nz`]: {
        body: { families: [], students: [], guardians: [] },
      },
      [`${POST}/families`]: { status: 201, body: { ...ngata, id: 'fam_new', name: 'Fonoti' } },
      [`${POST}/families/fam_new/guardians`]: {
        status: 201,
        body: { ...nimal, id: 'gdn_losa', email: 'losa@example.co.nz' },
      },
      [`${POST}/students`]: { status: 201, body: aria },
      [`${API}/families/fam_new`]: { body: { ...ngata, id: 'fam_new', name: 'Fonoti' } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add family' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add family' });
    const field = (name: string, index = 0) =>
      within(dialog).getAllByLabelText(new RegExp(`^${name}`))[index]!;

    await userEvent.type(field('Family name'), 'Fonoti');
    expect(
      await within(dialog).findByText('This looks like a family you already have'),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'It’s a different family' }));
    await userEvent.selectOptions(field('Home branch'), 'brn_albany');
    await userEvent.type(field('First name'), 'Losa');
    await userEvent.type(field('Last name'), 'Fonoti');
    await userEvent.type(field('Email'), 'losa@example.co.nz');
    await userEvent.type(field('First name', 1), 'Tavita');
    expect(field('Last name', 1)).toHaveValue('Fonoti');
    await userEvent.selectOptions(field('Grade'), 'grd_8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add family' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/o/bright-minds/families/fam_new',
    );
    const posts = calls.filter((c) => c.key.startsWith('POST'));
    expect(posts.map((c) => [c.key.replace(POST, ''), c.body])).toEqual([
      ['/families', { name: 'Fonoti', branchId: 'brn_albany' }],
      [
        '/families/fam_new/guardians',
        {
          firstName: 'Losa',
          lastName: 'Fonoti',
          email: 'losa@example.co.nz',
          emergencyContact: true,
        },
      ],
      [
        '/students',
        { familyId: 'fam_new', firstName: 'Tavita', lastName: 'Fonoti', gradeLevelId: 'grd_8' },
      ],
    ]);
  });

  it('still opens the family when a student could not be saved, and says why', async () => {
    stubApi({
      ...lookups,
      [`${API}/families?limit=50`]: { body: { data: [], nextCursor: null } },
      [`${API}/search/duplicates?kind=family&name=Fonoti`]: {
        body: { families: [], students: [], guardians: [] },
      },
      [`POST /api/v1/orgs/org_1/families`]: {
        status: 201,
        body: { ...ngata, id: 'fam_new', name: 'Fonoti' },
      },
      [`POST /api/v1/orgs/org_1/families/fam_new/guardians`]: { status: 201, body: nimal },
      [`POST /api/v1/orgs/org_1/students`]: {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'x',
            fields: { dateOfBirth: ['Can’t be in the future'] },
          },
        },
      },
      [`${API}/families/fam_new`]: { body: { ...ngata, id: 'fam_new', name: 'Fonoti' } },
    });
    renderRoutes(routes, '/o/bright-minds/families', inOrg('owner', ['brn_albany']));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add family' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add family' });
    // Limited to one branch: the family goes there without asking.
    expect(within(dialog).queryByLabelText(/^Home branch/)).toBeNull();
    const field = (name: string, index = 0) =>
      within(dialog).getAllByLabelText(new RegExp(`^${name}`))[index]!;
    await userEvent.type(field('Family name'), 'Fonoti');
    await userEvent.type(field('First name'), 'Losa');
    await userEvent.type(field('Last name'), 'Fonoti');
    await userEvent.type(field('First name', 1), 'Tavita');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add family' }));

    expect(
      await screen.findByText('The family was added, but some details weren’t saved'),
    ).toBeVisible();
    expect(screen.getByText('Tavita Fonoti: Can’t be in the future')).toBeVisible();
  });
});

describe('the family page', () => {
  const FAMILY = `${API}/families/fam_perera`;
  const billing = {
    [`${API}/invoices?familyId=fam_perera&limit=200`]: {
      body: {
        data: [
          invoice('inv_1', 'issued', 45000, '2026-01-14'),
          invoice('inv_22', 'paid', 0, '2026-01-14'),
          invoice('inv_333', 'draft', 45000, null),
        ],
        nextCursor: null,
      },
    },
    [`${API}/payments?familyId=fam_perera&limit=200`]: {
      body: {
        data: [
          {
            id: 'pay_1',
            familyId: 'fam_perera',
            familyName: 'Perera',
            branchId: 'brn_albany',
            method: 'bank_transfer',
            amount: money(45000),
            receivedOn: '2026-09-21',
            reference: null,
            notes: null,
            allocations: [],
            createdAt: at,
            updatedAt: at,
          },
        ],
        nextCursor: null,
      },
    },
  };

  it('shows the students, guardians, balance and payments', async () => {
    stubApi({ ...lookups, ...billing, [FAMILY]: { body: perera } });
    renderRoutes(routes, '/o/bright-minds/families/fam_perera', inOrg('owner'));

    expect(await screen.findByRole('heading', { name: 'Perera family' })).toBeVisible();
    expect(screen.getByText('7K2M9QXA')).toBeVisible();
    expect(screen.getByText('Albany branch ·')).toBeVisible();
    expect(screen.getByRole('link', { name: /Aria Perera/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/students/stu_aria',
    );
    expect(screen.getByText('Mother · Billing contact · Emergency contact')).toBeVisible();
    expect(screen.getByText('Father')).toBeVisible();
    expect(screen.getByText('Signed in')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Invite to portal' })).toBeVisible();

    expect(await screen.findByText('$450.00', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('1 overdue')).toBeVisible();
    expect(screen.getByText('Overdue')).toBeVisible();
    expect(screen.getByText('Draft')).toBeVisible();
    expect(await screen.findByText('Bank transfer')).toBeVisible();
    expect(screen.getByText('18 Kauri Road')).toBeVisible();
  });

  it('invites a guardian to the parent portal and shows the link', async () => {
    const calls = stubApi({
      ...lookups,
      ...billing,
      [FAMILY]: { body: perera },
      'POST /api/v1/orgs/org_1/guardians/gdn_nimal/invitation': {
        status: 201,
        body: {
          invitation: {
            id: 'ivt_1',
            email: 'nimal@example.co.nz',
            role: 'parent',
            branchIds: null,
          },
          token: 'tok-1',
        },
      },
    });
    renderRoutes(
      routes,
      '/o/bright-minds/families/fam_perera',
      inOrg('front_desk', ['brn_albany']),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Invite to portal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite to the parent portal' });
    expect(within(dialog).getByLabelText(/^Email/)).toHaveValue('nimal@example.co.nz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));

    expect(await within(dialog).findByText('Invite ready for Nimal')).toBeVisible();
    expect(within(dialog).getByRole('textbox')).toHaveValue(
      `${window.location.origin}/invitations/tok-1`,
    );
    expect(calls.find((c) => c.key.endsWith('/invitation'))!.body).toEqual({});
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByText(/Invited/)).toBeVisible();
  });

  it('won’t delete a family that still has students', async () => {
    stubApi({ ...lookups, ...billing, [FAMILY]: { body: perera } });
    renderRoutes(routes, '/o/bright-minds/families/fam_perera', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete family' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the Perera family?' });
    expect(
      within(dialog).getByText(
        'This family has a student. Remove the student first, then delete the family.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Delete family' })).toBeNull();
  });

  it('erases a family only once its name is typed', async () => {
    const calls = stubApi({
      ...lookups,
      ...billing,
      [FAMILY]: { body: perera },
      'POST /api/v1/orgs/org_1/families/fam_perera/erase': {
        body: { familyId: 'fam_perera', erasedAt: at, guardians: 2, students: 1 },
      },
    });
    renderRoutes(routes, '/o/bright-minds/families/fam_perera', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Erase personal data' }));
    const dialog = await screen.findByRole('dialog', { name: 'Erase personal data?' });
    const erase = within(dialog).getByRole('button', { name: 'Erase personal data' });
    expect(erase).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type Perera to confirm'), 'perera');
    await userEvent.click(erase);
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/erase'))).toBe(true));
  });

  it('is read only for a teacher, without the money', async () => {
    const calls = stubApi({ ...lookups, [FAMILY]: { body: perera } });
    renderRoutes(routes, '/o/bright-minds/families/fam_perera', inOrg('teacher'));
    expect(await screen.findByRole('heading', { name: 'Perera family' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add student' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite to portal' })).toBeNull();
    expect(screen.getByText('Not signed in')).toBeVisible();
    expect(screen.queryByText('Balance')).toBeNull();
    expect(calls.some((c) => c.key.includes('/invoices'))).toBe(false);
  });
});

describe('the student page', () => {
  const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;

  it('shows classes, upcoming lessons, grades, consents and notes', async () => {
    stubApi({
      ...lookups,
      [`${API}/students/stu_aria`]: { body: aria },
      [`${API}/enrolments?studentId=stu_aria&limit=200`]: {
        body: {
          data: [
            {
              id: 'enr_1',
              studentId: 'stu_aria',
              studentFirstName: 'Aria',
              studentLastName: 'Perera',
              classId: 'cls_maths',
              className: 'Year 7 Mathematics',
              courseId: 'crs_1',
              branchId: 'brn_albany',
              startDate: '2026-02-01',
              endDate: null,
              priceOverride: null,
              status: 'active',
              createdAt: at,
              updatedAt: at,
            },
          ],
          nextCursor: null,
        },
      },
      [`${API}/classes/cls_maths`]: {
        body: {
          id: 'cls_maths',
          name: 'Year 7 Mathematics',
          schedule: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
        },
      },
      [`${API}/makeup-credits?studentId=stu_aria&limit=200`]: {
        body: { data: [credit('mkc_1', '2026-12-12')], nextCursor: null },
      },
      // The next six weeks from today, in the browser's timezone until the org loads.
      [`${API}/sessions?studentId=stu_aria&from=${today}&to=${addDays(today, 41)}&limit=5`]: {
        body: {
          data: [
            {
              id: 'ses_1',
              classId: 'cls_maths',
              className: 'Year 7 Mathematics',
              date: '2026-11-02',
              startTime: '16:00',
              endTime: '17:00',
              status: 'cancelled',
              movedFrom: null,
            },
          ],
          nextCursor: null,
        },
      },
      [`${API}/students/stu_aria/consents`]: {
        body: {
          studentId: 'stu_aria',
          consents: [
            {
              type: 'photos',
              granted: true,
              guardianId: null,
              note: null,
              recordedByUserId: null,
              updatedAt: at,
            },
            {
              type: 'medical_treatment',
              granted: null,
              guardianId: null,
              note: null,
              recordedByUserId: null,
              updatedAt: null,
            },
          ],
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/students/stu_aria', inOrg('owner'));

    expect(await screen.findByRole('heading', { name: 'Aria Perera' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Perera family/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/families/fam_perera',
    );
    expect(await screen.findByText('Year 7 Mathematics', { selector: 'b' })).toBeVisible();
    expect(await screen.findByText('Mon 4:00 pm–5:00 pm')).toBeVisible();
    expect(await screen.findByText('Cancelled')).toBeVisible();
    expect(await screen.findByText('Missed Thu, 1 Oct · use by 12/12/2026')).toBeVisible();
    expect(screen.getByText('2026')).toBeVisible();
    expect(await screen.findByText('Granted')).toBeVisible();
    expect(screen.getByText('Not asked')).toBeVisible();
    expect(screen.getByText('Works best near the front.')).toBeVisible();
  });
});

describe('make-ups on the student page', () => {
  const today = localNow(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
  const lesson = (id: string, courseId: string, className: string, date: string) => ({
    id,
    classId: `cls_${id}`,
    className,
    courseId,
    branchId: 'brn_albany',
    roomId: null,
    roomName: 'Room 2',
    teacherId: null,
    teacherName: 'Sam Lee',
    date,
    startTime: '16:00',
    endTime: '17:00',
    startsAt: '2099-01-05T03:00:00.000Z',
    endsAt: '2099-01-05T04:00:00.000Z',
    status: 'scheduled',
    movedFrom: null,
    createdAt: at,
    updatedAt: at,
  });
  const booking = {
    id: 'mkb_1',
    creditId: 'mkc_2',
    studentId: 'stu_aria',
    sessionId: 'ses_booked',
    date: addDays(today, 7),
    startTime: '15:30',
    classId: 'cls_science',
    className: 'Year 7 Science',
    createdAt: at,
  };
  const page = {
    ...lookups,
    [`${API}/students/stu_aria`]: { body: aria },
    [`${API}/enrolments?studentId=stu_aria&limit=200`]: { body: { data: [], nextCursor: null } },
    [`${API}/sessions?studentId=stu_aria&from=${today}&to=${addDays(today, 41)}&limit=5`]: {
      body: { data: [], nextCursor: null },
    },
    [`${API}/students/stu_aria/consents`]: { body: { studentId: 'stu_aria', consents: [] } },
    [`${API}/classes/cls_maths`]: { body: { id: 'cls_maths', name: 'Year 7 Mathematics' } },
    [`${API}/makeup-credits?studentId=stu_aria&limit=200`]: {
      body: {
        data: [
          credit('mkc_1', null),
          { ...credit('mkc_2', null), status: 'used', booking },
          { ...credit('mkc_3', null), status: 'expired' },
        ],
        nextCursor: null,
      },
    },
  };

  it('books a credit into a lesson of the same course, leaving out the student’s own', async () => {
    const to = addDays(today, 27);
    const calls = stubApi({
      ...page,
      [`${API}/makeup-policy`]: {
        body: {
          enabled: true,
          creditForExcused: true,
          creditForAbsent: false,
          requireNotice: true,
          expiryDays: null,
          sameCourseOnly: true,
          updatedAt: at,
        },
      },
      [`${API}/sessions?branchId=brn_albany&from=${today}&to=${to}&limit=200`]: {
        body: {
          data: [
            lesson('ses_own', 'crs_maths', 'Year 7 Mathematics A', addDays(today, 1)),
            lesson('ses_free', 'crs_maths', 'Year 7 Mathematics B', addDays(today, 2)),
            lesson('ses_other', 'crs_english', 'Year 7 English', addDays(today, 2)),
            lesson('ses_booked', 'crs_maths', 'Year 7 Mathematics C', addDays(today, 3)),
            {
              ...lesson('ses_off', 'crs_maths', 'Year 7 Mathematics D', addDays(today, 4)),
              status: 'cancelled',
            },
          ],
          nextCursor: null,
        },
      },
      [`${API}/sessions?studentId=stu_aria&from=${today}&to=${to}&limit=200`]: {
        body: { data: [{ id: 'ses_own' }], nextCursor: null },
      },
      'POST /api/v1/orgs/org_1/makeup-bookings': {
        status: 201,
        body: { ...booking, id: 'mkb_2', creditId: 'mkc_1', sessionId: 'ses_free' },
      },
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/o/bright-minds/students/stu_aria', inOrg('owner'));

    expect(await screen.findByText('Year 7 Science')).toBeVisible();
    expect(screen.getAllByText('Missed Thu, 1 Oct · doesn’t expire')).toHaveLength(1);
    await user.click(
      await screen.findByRole('button', { name: /Book a make-up for the lesson missed/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Book a make-up for Aria' });
    expect(within(dialog).getByText('Missed Year 7 Mathematics on Thu, 1 Oct')).toBeVisible();
    const options = await within(dialog).findAllByRole('radio');
    expect(options).toHaveLength(1);
    expect(within(dialog).getByText(/Year 7 Mathematics B · Sam Lee · Room 2/)).toBeVisible();
    expect(within(dialog).queryByText(/Show other courses/)).toBeNull();

    await user.click(options[0]!);
    await user.click(within(dialog).getByRole('button', { name: 'Book' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('POST'))?.body).toEqual({
        creditId: 'mkc_1',
        sessionId: 'ses_free',
      }),
    );
    expect(await screen.findByText(/Aria is booked in for/)).toBeVisible();
  });

  it('offers other courses when the policy allows, and shows why a booking is refused', async () => {
    const to = addDays(today, 27);
    stubApi({
      ...page,
      [`${API}/makeup-policy`]: {
        body: {
          enabled: true,
          creditForExcused: true,
          creditForAbsent: false,
          requireNotice: true,
          expiryDays: null,
          sameCourseOnly: false,
          updatedAt: at,
        },
      },
      [`${API}/sessions?branchId=brn_albany&from=${today}&to=${to}&limit=200`]: {
        body: {
          data: [lesson('ses_other', 'crs_english', 'Year 7 English', addDays(today, 2))],
          nextCursor: null,
        },
      },
      [`${API}/sessions?studentId=stu_aria&from=${today}&to=${to}&limit=200`]: {
        body: { data: [], nextCursor: null },
      },
      'POST /api/v1/orgs/org_1/makeup-bookings': {
        status: 422,
        body: { error: { code: 'unprocessable', message: 'That lesson is full.' } },
      },
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/o/bright-minds/students/stu_aria', inOrg('owner'));

    await user.click(
      await screen.findByRole('button', { name: /Book a make-up for the lesson missed/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Book a make-up for Aria' });
    expect(await within(dialog).findByText(/No lessons with a place/)).toBeVisible();
    await user.click(within(dialog).getByLabelText('Show other courses’ lessons too'));
    await user.click(within(dialog).getByRole('radio'));
    await user.click(within(dialog).getByRole('button', { name: 'Book' }));
    expect(await within(dialog).findByText('That lesson is full.')).toBeVisible();
  });

  it('cancels a booked make-up', async () => {
    const calls = stubApi({
      ...page,
      'DELETE /api/v1/orgs/org_1/makeup-bookings/mkb_1': { status: 204 },
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/o/bright-minds/students/stu_aria', inOrg('owner'));

    await user.click(await screen.findByRole('button', { name: /Cancel the make-up on/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this make-up?' });
    expect(within(dialog).getByText(/Aria comes off Year 7 Science on/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel make-up' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'DELETE /api/v1/orgs/org_1/makeup-bookings/mkb_1')).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Make-up cancelled')).toBeVisible();
  });

  it('shows a teacher the credits without booking or cancelling', async () => {
    stubApi(page);
    renderRoutes(routes, '/o/bright-minds/students/stu_aria', inOrg('teacher'));

    expect(await screen.findByText('Year 7 Science')).toBeVisible();
    expect(screen.getByText('Available')).toBeVisible();
    expect(screen.getByText('Booked')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Book a make-up/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel the make-up/ })).toBeNull();
  });
});

describe('the global search', () => {
  it('opens with Ctrl K and goes to what is picked', async () => {
    stubApi({
      [`${API}/search?q=aria&limit=5`]: {
        body: {
          families: [],
          students: [{ ...aria, familyName: 'Perera' }],
          guardians: [],
        },
      },
    });
    renderRoutes(
      [
        {
          path: '*',
          element: (
            <AppShell>
              <Where />
            </AppShell>
          ),
        },
      ],
      '/o/bright-minds',
      inOrg('front_desk'),
    );
    expect(screen.getByRole('link', { name: 'Families & students' })).toBeVisible();

    await userEvent.keyboard('{Control>}k{/Control}');
    const box = await screen.findByRole('combobox', { name: 'Search' });
    await userEvent.type(box, 'aria');
    expect(await screen.findByRole('option', { name: /Aria Perera/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/o/bright-minds/students/stu_aria');
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull();
  });
});
