import { screen, waitFor, within } from '@testing-library/react';
import { addDays, localNow } from '@edustrux/shared/dates';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { ClassesPage } from '../src/pages/classes/ClassesPage';
import { ClassPage } from '../src/pages/classes/ClassPage';
import { LessonPage } from '../src/pages/classes/LessonPage';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The classes area (TUI-112): the list, adding a class, the class page and the attendance sheet.

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
const termStart = addDays(today, -14);
const termEnd = addDays(today, 56);

const routes = [
  { path: '/o/:orgSlug/classes', element: <ClassesPage /> },
  {
    path: '/o/:orgSlug/classes/:classId',
    element: (
      <>
        <ClassPage />
        <Where />
      </>
    ),
  },
  { path: '/o/:orgSlug/lessons/:sessionId', element: <LessonPage /> },
];

const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });
const term = {
  id: 'trm_4',
  academicYearId: 'acy',
  name: 'Term 4',
  startDate: termStart,
  endDate: termEnd,
  createdAt: at,
  updatedAt: at,
};
const course = {
  id: 'crs_y9m',
  subjectId: 'sbj_maths',
  gradeLevelId: 'grd_9',
  curriculum: null,
  teachingMedium: null,
  defaultPrice: null,
  durationMinutes: 60,
  createdAt: at,
  updatedAt: at,
};
const lookups = {
  [`${API}/terms?limit=200`]: page([term]),
  [`${API}/branches?limit=200`]: page([{ id: 'brn_main', name: 'Main', address: null }]),
  [`${API}/subjects?limit=200`]: page([{ id: 'sbj_maths', name: 'Maths' }]),
  [`${API}/courses?limit=200`]: page([course]),
  [`${API}/grade-levels`]: page([{ id: 'grd_9', name: 'Year 9', sortOrder: 1 }]),
  [`${API}/teachers`]: page([
    { id: 'mem_np', name: 'Nimali Perera', role: 'teacher', branchIds: null },
    { id: 'mem_jl', name: 'Jason Lee', role: 'teacher', branchIds: null },
  ]),
  [`${API}/branches/brn_main/rooms?limit=200`]: page([
    { id: 'rm_3', branchId: 'brn_main', name: 'Room 3', capacity: null },
  ]),
  [`${API}/holidays?limit=200`]: page([]),
};

const groupA = {
  id: 'cls_a',
  courseId: 'crs_y9m',
  gradeLevelId: 'grd_9',
  termId: 'trm_4',
  branchId: 'brn_main',
  roomId: 'rm_3',
  roomName: 'Room 3',
  teacherId: 'mem_np',
  teacherName: 'Nimali Perera',
  name: 'Group A',
  capacity: 12,
  enrolledCount: 9,
  startDate: null,
  endDate: null,
  schedule: [
    { weekday: 2, startTime: '16:00', endTime: '17:00' },
    { weekday: 4, startTime: '16:00', endTime: '17:00' },
  ],
  createdAt: at,
  updatedAt: at,
};
const full = { ...groupA, id: 'cls_b', name: 'Extension', enrolledCount: 12, schedule: [] };

describe('the classes list', () => {
  it('shows each class with its course, schedule, room, teacher and places', async () => {
    stubApi({
      ...lookups,
      [`${API}/classes?limit=100&termId=trm_4`]: page([groupA, full]),
    });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('owner'));

    const row = (await screen.findByText('Group A')).closest('a')!;
    expect(row).toHaveAttribute('href', '/o/bright-minds/classes/cls_a');
    expect(within(row).getByText('Year 9 Maths · Term 4')).toBeVisible();
    expect(within(row).getAllByText('Tue & Thu 4:00 pm–5:00 pm')[0]).toBeInTheDocument();
    expect(within(row).getByText('Room 3')).toBeVisible();
    expect(within(row).getByText('Nimali Perera')).toBeVisible();
    expect(within(row).getByText('9 / 12')).toBeVisible();
    const other = screen.getByText('Extension').closest('a')!;
    expect(within(other).getByText('Full')).toBeInTheDocument();
    expect(within(other).getAllByText('No schedule yet')[0]).toBeInTheDocument();
    expect(screen.getByText('2 classes · 21 students enrolled')).toBeVisible();
  });

  it('searches the classes it has, by name, course or teacher', async () => {
    stubApi({ ...lookups, [`${API}/classes?limit=100&termId=trm_4`]: page([groupA, full]) });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('owner'));
    await screen.findByText('Group A');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search classes…' }), 'ext');
    expect(screen.queryByText('Group A')).toBeNull();
    expect(screen.getByText('Extension')).toBeVisible();
  });

  it('gives a teacher their classes without the add button or the teacher filter', async () => {
    const calls = stubApi({
      ...lookups,
      [`${API}/classes?limit=100&termId=trm_4`]: page([groupA]),
    });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('teacher'));
    await screen.findByText('Group A');
    expect(screen.queryByRole('button', { name: 'Add class' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Teacher' })).toBeNull();
    // A teacher can't list who teaches, so the page doesn't ask.
    expect(calls.some((c) => c.key === `${API}/teachers`)).toBe(false);
  });

  it('is not for parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('adding a class', () => {
  it('asks for what is required, and checks the times, before sending anything', async () => {
    const calls = stubApi({ ...lookups, [`${API}/classes?limit=100&termId=trm_4`]: page([]) });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add class' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add class' });
    await userEvent.clear(within(dialog).getByLabelText('End'));
    await userEvent.type(within(dialog).getByLabelText('End'), '15:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add class' }));

    expect(within(dialog).getAllByText('This is required.')).toHaveLength(2); // course, name
    expect(within(dialog).getByText('Must be after the start')).toBeVisible();
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('adds the class with its weekly schedule, then opens it', async () => {
    const created = { ...groupA, id: 'cls_new', name: 'Group B', schedule: [], enrolledCount: 0 };
    const calls = stubApi({
      ...lookups,
      [`${API}/classes?limit=100&termId=trm_4`]: page([]),
      'POST /api/v1/orgs/org_1/classes': { status: 201, body: created },
      'PUT /api/v1/orgs/org_1/classes/cls_new/schedule': {
        body: {
          class: created,
          sessions: { added: 10, removed: 0, kept: 0, through: termEnd },
        },
      },
      [`${API}/classes/cls_new`]: { body: created },
      [`${API}/sessions?classId=cls_new&from=${termStart}&to=${termEnd}&limit=200`]: page([]),
      [`${API}/enrolments?classId=cls_new&limit=200`]: page([]),
      [`${API}/timetable/clashes?from=${today}&to=${addDays(today, 91)}&branchId=brn_main`]: {
        body: { data: [] },
      },
    });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add class' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add class' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Course/), 'crs_y9m');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Group B');
    await userEvent.type(within(dialog).getByLabelText('Capacity'), '10');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Room'), 'rm_3');
    await userEvent.selectOptions(within(dialog).getByLabelText('Teacher'), 'mem_jl');
    await userEvent.selectOptions(within(dialog).getByLabelText('Day'), '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add class' }));

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/o/bright-minds/classes/cls_new?tab=schedule',
      ),
    );
    expect(calls.find((c) => c.key === 'POST /api/v1/orgs/org_1/classes')?.body).toEqual({
      courseId: 'crs_y9m',
      termId: 'trm_4',
      branchId: 'brn_main',
      name: 'Group B',
      capacity: 10,
      roomId: 'rm_3',
      teacherId: 'mem_jl',
      startDate: null,
      endDate: null,
    });
    expect(
      calls.find((c) => c.key === 'PUT /api/v1/orgs/org_1/classes/cls_new/schedule')?.body,
    ).toEqual({ slots: [{ weekday: 3, startTime: '16:00', endTime: '17:00' }] });
    expect(await screen.findByText('Class added')).toBeVisible();
  });

  it('runs an ongoing class from a start date instead of a term', async () => {
    stubApi({ ...lookups, [`${API}/classes?limit=100&termId=trm_4`]: page([]) });
    renderRoutes(routes, '/o/bright-minds/classes', inOrg('owner'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add class' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add class' });
    expect(within(dialog).getByLabelText(/^Term/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('switch', { name: /Ongoing, no term/ }));
    expect(within(dialog).queryByLabelText(/^Term/)).toBeNull();
    expect(within(dialog).getByLabelText(/^Start date/)).toHaveValue(today);
    expect(within(dialog).getByLabelText('End date')).toBeVisible();
  });
});

describe('the class page', () => {
  const lesson = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
    id,
    classId: 'cls_a',
    className: 'Group A',
    courseId: 'crs_y9m',
    branchId: 'brn_main',
    roomId: 'rm_3',
    roomName: 'Room 3',
    teacherId: 'mem_np',
    teacherName: 'Nimali Perera',
    date,
    startTime: '16:00',
    endTime: '17:00',
    startsAt: `${date}T03:00:00.000Z`,
    endsAt: `${date}T04:00:00.000Z`,
    status: 'scheduled',
    movedFrom: null,
    attendance: { present: 0, late: 0, absent: 0, excused: 0 },
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  const enrolment = (id: string, first: string, extra: Record<string, unknown> = {}) => ({
    id,
    studentId: `stu_${id}`,
    studentFirstName: first,
    studentLastName: 'Perera',
    classId: 'cls_a',
    className: 'Group A',
    courseId: 'crs_y9m',
    branchId: 'brn_main',
    startDate: termStart,
    endDate: null,
    priceOverride: null,
    status: 'active',
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  const classStubs = (klass = groupA) => ({
    ...lookups,
    [`${API}/classes/${klass.id}`]: { body: klass },
    [`${API}/sessions?classId=${klass.id}&from=${termStart}&to=${termEnd}&limit=200`]: page([
      lesson('ses_past', addDays(today, -2), {
        attendance: { present: 8, late: 0, absent: 1, excused: 0 },
      }),
      // Today's, not over yet whatever the time of the run.
      lesson('ses_today', today, {
        startsAt: `${addDays(today, 1)}T03:00:00.000Z`,
        endsAt: `${addDays(today, 1)}T04:00:00.000Z`,
      }),
      lesson('ses_next', addDays(today, 5)),
      lesson('ses_off', addDays(today, 7), { status: 'cancelled' }),
    ]),
    [`${API}/enrolments?classId=${klass.id}&limit=200`]: page([
      enrolment('aria', 'Aria'),
      enrolment('leo', 'Leo', { status: 'withdrawn', endDate: addDays(today, -3) }),
    ]),
  });

  it('shows the class, its numbers and its students', async () => {
    stubApi(classStubs());
    renderRoutes(routes, '/o/bright-minds/classes/cls_a', inOrg('owner'));
    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeVisible();
    expect(screen.getByText('Year 9 Maths · Term 4 · Room 3 · Nimali Perera')).toBeVisible();
    expect(screen.getByText('9 / 12')).toBeVisible();
    expect(screen.getByText('3 places left')).toBeVisible();
    expect(await screen.findByText('1 of 3')).toBeVisible(); // one lesson done, the cancelled left out
    const aria = (await screen.findByText('Aria Perera')).closest('li')!;
    expect(within(aria).getByText('Active')).toBeVisible();
    const leo = screen.getByText('Leo Perera').closest('li')!;
    expect(within(leo).getByText('Withdrawn')).toBeVisible();
  });

  it('lists the lessons with their results, and the way to mark today’s', async () => {
    stubApi(classStubs());
    renderRoutes(routes, '/o/bright-minds/classes/cls_a?tab=lessons', inOrg('owner'));
    expect(await screen.findByText('8 present · 1 absent')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Mark attendance' })).toHaveAttribute(
      'href',
      '/o/bright-minds/lessons/ses_today',
    );
    expect(screen.getByText('Cancelled')).toBeVisible();
    // Only one lesson to mark: the one still to come shows nothing.
    expect(screen.getAllByRole('link', { name: 'Mark attendance' })).toHaveLength(1);
  });

  it('won’t offer to enrol into a full class', async () => {
    stubApi({ ...classStubs(full), [`${API}/search?q=ar&limit=20`]: { body: { students: [] } } });
    renderRoutes(routes, '/o/bright-minds/classes/cls_b', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Enrol student' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enrol a student' });
    expect(within(dialog).getByText(/This class is full: all 12 places are taken/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Enrol' })).toBeDisabled();
  });

  it('withdraws a student from their last day', async () => {
    const calls = stubApi({
      ...classStubs(),
      'PATCH /api/v1/orgs/org_1/enrolments/aria': {
        body: { enrolment: enrolment('aria', 'Aria'), transferredTo: null, invoices: [] },
      },
    });
    renderRoutes(routes, '/o/bright-minds/classes/cls_a', inOrg('owner'));
    const row = (await screen.findByText('Aria Perera')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Actions for Aria Perera' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw Aria Perera?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/v1/orgs/org_1/enrolments/aria')?.body).toEqual(
        {
          updatedAt: at,
          status: 'withdrawn',
          endDate: today,
        },
      ),
    );
  });

  it('is read only for a teacher', async () => {
    stubApi(classStubs());
    renderRoutes(routes, '/o/bright-minds/classes/cls_a', inOrg('teacher'));
    await screen.findByText('Aria Perera');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enrol student' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
});

describe('the attendance sheet', () => {
  const session = {
    id: 'ses_a',
    classId: 'cls_a',
    className: 'Group A',
    courseId: 'crs_y9m',
    branchId: 'brn_main',
    roomId: 'rm_3',
    roomName: 'Room 3',
    teacherId: 'mem_np',
    teacherName: 'Nimali Perera',
    date: today,
    startTime: '16:00',
    endTime: '17:00',
    startsAt: at,
    endsAt: at,
    status: 'scheduled',
    movedFrom: null,
    attendance: { present: 1, late: 0, absent: 0, excused: 0 },
    createdAt: at,
    updatedAt: at,
  };
  const record = (id: string, first: string, extra: Record<string, unknown> = {}) => ({
    studentId: id,
    studentFirstName: first,
    studentLastName: 'Perera',
    status: null,
    markedAt: null,
    absenceNotice: null,
    ...extra,
  });
  const stubs = (extra: Record<string, unknown> = {}) => ({
    [`${API}/sessions/ses_a`]: { body: { ...session, ...extra } },
    [`${API}/sessions/ses_a/attendance`]: {
      body: {
        sessionId: 'ses_a',
        records: [
          record('stu_aria', 'Aria', { status: 'present', markedAt: at }),
          record('stu_maia', 'Maia'),
          record('stu_jack', 'Jack'),
          record('stu_aroha', 'Aroha', {
            absenceNotice: { id: 'abn_1', reason: 'dentist', source: 'parent' },
          }),
        ],
      },
    },
    [`${API}/sessions/ses_a/notes`]: {
      body: { sessionId: 'ses_a', homework: null, homeworkUpdatedAt: null, notes: [] },
    },
  });

  it('marks the rest present, one absent, adds a note, and saves only what changed', async () => {
    const calls = stubApi({
      ...stubs(),
      'PUT /api/v1/orgs/org_1/sessions/ses_a/attendance': {
        body: { sessionId: 'ses_a', records: [] },
      },
      'PUT /api/v1/orgs/org_1/sessions/ses_a/notes': { body: {} },
    });
    renderRoutes(routes, '/o/bright-minds/lessons/ses_a', inOrg('teacher'));

    // A notice from home starts the student as excused, for staff to confirm.
    const aroha = (await screen.findByText('Aroha Perera')).closest('li')!;
    expect(within(aroha).getByText('Parent said away: dentist')).toBeVisible();
    expect(within(aroha).getByRole('radio', { name: 'Excused' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('2 of 4 marked')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Mark the rest present' }));
    const jack = screen.getByText('Jack Perera').closest('li')!;
    await userEvent.click(within(jack).getByRole('radio', { name: 'Absent' }));
    await userEvent.click(within(jack).getByRole('button', { name: 'Note for Jack Perera' }));
    await userEvent.type(within(jack).getByRole('textbox'), 'Felt unwell at lunch');
    expect(screen.getByText('4 of 4 marked')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'PUT /api/v1/orgs/org_1/sessions/ses_a/attendance')?.body,
      ).toEqual({
        records: [
          { studentId: 'stu_maia', status: 'present' },
          { studentId: 'stu_jack', status: 'absent' },
          { studentId: 'stu_aroha', status: 'excused' },
        ],
      }),
    );
    expect(
      calls.find((c) => c.key === 'PUT /api/v1/orgs/org_1/sessions/ses_a/notes')?.body,
    ).toEqual({
      notes: [{ studentId: 'stu_jack', note: 'Felt unwell at lunch' }],
    });
    expect(await screen.findByText('Attendance saved')).toBeVisible();
  });

  it('can’t be marked before the lesson’s day, or once it is cancelled', async () => {
    stubApi(stubs({ status: 'cancelled' }));
    renderRoutes(routes, '/o/bright-minds/lessons/ses_a', inOrg('owner'));
    expect(
      await screen.findByText('This lesson was cancelled, so there’s no attendance to mark.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
    expect(screen.getAllByRole('radio', { name: 'Present' })[1]).toBeDisabled();
  });

  it('opens on the lesson’s day', async () => {
    stubApi(stubs({ date: addDays(today, 3) }));
    renderRoutes(routes, '/o/bright-minds/lessons/ses_a', inOrg('owner'));
    expect(await screen.findByText('Attendance opens on the day of the lesson.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark the rest present' })).toBeNull();
  });
});
