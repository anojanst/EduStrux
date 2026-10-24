import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { CoursesPage } from '../src/pages/courses/CoursesPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Courses (TUI-113): courses by grade level, subjects and grade levels.

const membershipOrg = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Chen',
          memberships: [{ id: 'mem_me', role, branchIds: null, org: membershipOrg }],
        },
        membership: { id: 'mem_me', role, branchIds: null, org: membershipOrg },
        org: {
          currency: 'NZD',
          locale: 'en-NZ',
          dateFormat: 'DD/MM/YYYY',
          timezone: 'Pacific/Auckland',
        } as never,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const ORG = '/api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
const routes = [{ path: '/o/:orgSlug/settings/courses', element: <CoursesPage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });

const subjects = [
  { id: 'sbj_maths', name: 'Mathematics', createdAt: at, updatedAt: at },
  { id: 'sbj_eng', name: 'English', createdAt: at, updatedAt: at },
  { id: 'sbj_phy', name: 'Physics', createdAt: at, updatedAt: at },
];
const grades = [
  { id: 'grd_9', name: 'Year 9', sortOrder: 1, createdAt: at, updatedAt: at },
  { id: 'grd_10', name: 'Year 10', sortOrder: 2, createdAt: at, updatedAt: at },
];
const course = (id: string, extra: Record<string, unknown>) => ({
  id,
  subjectId: 'sbj_maths',
  gradeLevelId: 'grd_9',
  curriculum: null,
  teachingMedium: null,
  defaultPrice: null,
  durationMinutes: 60,
  classCount: 0,
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const courses = [
  course('crs_cam', {
    curriculum: 'Cambridge',
    teachingMedium: 'English',
    defaultPrice: { amount: 45000, currency: 'NZD' },
    classCount: 4,
  }),
  course('crs_eng', { subjectId: 'sbj_eng', durationMinutes: 45 }),
  course('crs_phy', {
    subjectId: 'sbj_phy',
    gradeLevelId: 'grd_10',
    durationMinutes: 90,
    defaultPrice: { amount: 52000, currency: 'NZD' },
  }),
];
const lookups = {
  [`${API}/subjects?limit=200`]: page(subjects),
  [`${API}/grade-levels`]: page(grades),
  [`${API}/courses?limit=200`]: page(courses),
};

const open = (path = '/o/bright-minds/settings/courses', role: Role = 'owner') =>
  renderRoutes(routes, path, inOrg(role));
const rowOf = async (name: string) =>
  (await screen.findAllByText(name)).map((el) => el.closest('li')!).find(Boolean)!;

describe('the courses tab', () => {
  it('lists courses by grade level with their classes, lesson length and price', async () => {
    stubApi(lookups);
    open();
    expect(await screen.findByText('3 courses across 2 grade levels')).toBeVisible();
    const year9 = screen.getByRole('region', { name: 'Year 9' });
    expect(within(year9).getByText('Year 9 · 2 courses')).toBeVisible();
    // Subjects in name order within a grade.
    const rows = within(year9).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['English', 'Mathematics']);
    const maths = rows[1]!;
    expect(within(maths).getByText('Cambridge · English')).toBeVisible();
    expect(within(maths).getAllByText('4 classes')[0]).toBeInTheDocument();
    expect(within(maths).getAllByText('$450.00 / term')[0]).toBeInTheDocument();
    expect(within(rows[0]!).getAllByText('Not set')[0]).toBeInTheDocument();
    expect(within(rows[0]!).getAllByText('No classes')[0]).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Year 10' })).toBeVisible();

    // The filters narrow the list.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grade level' }), 'grd_10');
    expect(screen.queryByRole('region', { name: 'Year 9' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grade level' }), '');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses…' }), 'camb');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('adds a course with a price in minor units', async () => {
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/courses`]: { status: 201, body: course('crs_new', {}) },
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Add course' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add course' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Subject/), 'sbj_phy');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Grade level/), 'grd_9');
    await userEvent.type(within(dialog).getByLabelText('Curriculum (optional)'), 'Edexcel');
    await userEvent.type(within(dialog).getByLabelText('Default price'), '420.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.key === `POST ${ORG}/courses`)?.body).toEqual({
      subjectId: 'sbj_phy',
      gradeLevelId: 'grd_9',
      curriculum: 'Edexcel',
      teachingMedium: null,
      durationMinutes: 60,
      defaultPrice: { amount: 42050, currency: 'NZD' },
    });
  });

  it('lets front desk edit a course but not its price', async () => {
    const calls = stubApi({
      ...lookups,
      [`PATCH ${ORG}/courses/crs_cam`]: { body: courses[0] },
    });
    open(undefined, 'front_desk');
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Actions for Year 9 Mathematics · Cambridge · English',
      }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit course' });
    expect(within(dialog).getByText('Year 9 Mathematics')).toBeVisible();
    expect(within(dialog).getByText('Only the owner sets prices.')).toBeVisible();
    expect(within(dialog).queryByRole('textbox', { name: 'Default price' })).toBeNull();
    await userEvent.clear(within(dialog).getByLabelText('Lesson length (minutes)'));
    await userEvent.type(within(dialog).getByLabelText('Lesson length (minutes)'), '75');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
      updatedAt: at,
      curriculum: 'Cambridge',
      teachingMedium: 'English',
      durationMinutes: 75,
    });
  });

  it('says what a course is used by before deleting, and deletes one that is free', async () => {
    const calls = stubApi({ ...lookups, [`DELETE ${ORG}/courses/crs_eng`]: { status: 204 } });
    open();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Actions for Year 9 Mathematics · Cambridge · English',
      }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog', {
      name: 'Delete Year 9 Mathematics · Cambridge?',
    });
    expect(within(dialog).getByText(/Delete this course’s 4 classes first/)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'View classes' })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes?term=all&course=crs_cam',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Year 9 English' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete Year 9 English?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === `DELETE ${ORG}/courses/crs_eng`)).toBe(true),
    );
  });

  it('is not for teachers', async () => {
    stubApi(lookups);
    open(undefined, 'teacher');
    expect(await screen.findByText(/permission/i)).toBeVisible();
  });
});

describe('subjects and grade levels', () => {
  it('lets the owner add and rename a subject, and refuses to delete one in use', async () => {
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/subjects`]: { status: 201, body: { ...subjects[0], id: 'sbj_chem' } },
      [`PATCH ${ORG}/subjects/sbj_eng`]: {
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'A subject with that name already exists',
            fields: { name: ['Taken'] },
          },
        },
      },
    });
    open('/o/bright-minds/settings/courses?tab=subjects');
    const maths = await rowOf('Mathematics');
    expect(within(maths).getByText('1 course')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add subject' });
    await userEvent.type(within(dialog).getByLabelText(/^Subject/), 'Chemistry');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.key === `POST ${ORG}/subjects`)?.body).toEqual({
      name: 'Chemistry',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for English' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    dialog = await screen.findByRole('dialog', { name: 'Rename subject' });
    await userEvent.clear(within(dialog).getByLabelText(/^Subject/));
    await userEvent.type(within(dialog).getByLabelText(/^Subject/), 'Mathematics');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('A subject with that name already exists'),
    ).toBeVisible();
    expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
      updatedAt: at,
      name: 'Mathematics',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Mathematics' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete Mathematics?' });
    expect(within(dialog).getByText(/Delete this subject’s 1 course first/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('moves a grade level down', async () => {
    const calls = stubApi({
      ...lookups,
      [`PUT ${ORG}/grade-levels/order`]: page([grades[1], grades[0]]),
    });
    open('/o/bright-minds/settings/courses?tab=grades');
    expect(await screen.findByRole('button', { name: 'Move Year 9 up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Year 9 down' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Year 10'));
    expect(calls.find((c) => c.key.startsWith('PUT'))?.body).toEqual({
      ids: ['grd_10', 'grd_9'],
    });
  });

  it('shows front desk the subjects without changing them', async () => {
    stubApi(lookups);
    open('/o/bright-minds/settings/courses?tab=subjects', 'front_desk');
    expect(
      await screen.findByText('Only the owner adds or changes subjects and grade levels.'),
    ).toBeVisible();
    expect(await screen.findByText('Mathematics')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add subject' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });
});
