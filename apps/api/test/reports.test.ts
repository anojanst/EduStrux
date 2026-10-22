import { attendance, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Reports (TUI-62, TUI-63): the home dashboard and the money report.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' });

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * Two branches. Main has Maths (taught by `teacher`, $450 a term + 15% GST) with Aroha and Ben
 * of the Perera family; Albany has a class with Ari of the Ngata family. Each class had a lesson
 * yesterday and has one today; Maths' was marked yesterday. The Perera invoice is issued, due
 * 40 days ago, with $200 paid by cash today; the Ngata invoice is a draft.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  await make('/tax-rates', { name: 'GST', rateBps: 1500, inclusive: false, isDefault: true });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(45000),
  });
  const start = nextMonday();
  const year = await make('/academic-years', {
    name: 'Year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: addDays(today(), -14),
    endDate: addDays(start, 69),
  });
  const teacher = await member('teacher');
  const addClass = async (name: string, branchId: string, body: Record<string, unknown> = {}) => {
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId,
      name,
      ...body,
    });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    return klass;
  };
  const maths = await addClass('Maths', main.id, { teacherId: teacher.id });
  const albanyClass = await addClass('Albany Maths', albany.id);
  const perera = await make('/families', { name: 'Perera', branchId: main.id });
  const ngata = await make('/families', { name: 'Ngata', branchId: albany.id });
  const student = (familyId: string, firstName: string) =>
    make('/students', { familyId, firstName, lastName: 'X' });
  const aroha = await student(perera.id, 'Aroha');
  const ben = await student(perera.id, 'Ben');
  const ari = await student(ngata.id, 'Ari');
  for (const [s, c] of [
    [aroha, maths],
    [ben, maths],
    [ari, albanyClass],
  ] as const) {
    await make('/enrolments', { studentId: s.id, classId: c.id, startDate: addDays(today(), -7) });
  }

  // Yesterday's and today's lessons, written straight in.
  const lesson = async (
    classId: string,
    date: string,
    status: 'scheduled' | 'cancelled' = 'scheduled',
  ) => {
    const id = newId('session');
    await db().insert(sessions).values({
      id,
      orgId: org.id,
      classId,
      date,
      startTime: '23:00',
      endTime: '23:30',
      status,
    });
    return id;
  };
  const mathsYesterday = await lesson(maths.id, addDays(today(), -1));
  await lesson(maths.id, today());
  await lesson(albanyClass.id, addDays(today(), -1));
  await lesson(albanyClass.id, today(), 'cancelled');
  await db()
    .insert(attendance)
    .values({
      id: newId('attendance'),
      orgId: org.id,
      sessionId: mathsYesterday,
      studentId: aroha.id,
      status: 'present',
    });

  const started = await api('POST', `/terms/${term.id}/generate-invoices`, {});
  for (let i = 0; i < 400; i++) {
    const job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
    if (job.status === 'succeeded') break;
    if (job.status === 'failed') throw new Error(job.error);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const invoiceOf = async (familyId: string) =>
    (await api('GET', `/invoices?familyId=${familyId}`)).body.data[0] as Row & {
      total: { amount: number };
    };
  const pereraInvoice = await invoiceOf(perera.id);
  await api('PATCH', `/invoices/${pereraInvoice.id}`, {
    updatedAt: pereraInvoice.updatedAt,
    dueDate: addDays(today(), -40),
  });
  await api('POST', `/invoices/${pereraInvoice.id}/issue`);
  await make('/payments', {
    familyId: perera.id,
    method: 'cash',
    amount: nzd(20000),
    allocations: [{ invoiceId: pereraInvoice.id, amount: nzd(20000) }],
  });

  return { org, base, api, member, main, albany, teacher, perera, pereraInvoice, start };
}

describe('GET /reports/dashboard', () => {
  it('counts what the owner reaches, with money', async () => {
    const { api } = await setup();
    const res = await api('GET', '/reports/dashboard');
    expect(res.status).toBe(200);
    // Two families: Perera's $1035 invoice issued (two children, $450 + 15% each), $200 paid.
    expect(res.body).toEqual({
      date: today(),
      families: 2,
      students: 3,
      classes: 2,
      today: { lessons: 2, cancelled: 1, marked: 0, absenceNotices: 0 },
      unmarkedLessons: 2,
      makeupCreditsAvailable: 0,
      money: {
        owing: nzd(103500 - 20000),
        overdue: nzd(103500 - 20000),
        overdueInvoices: 1,
        receivedThisMonth: nzd(20000),
        draftInvoices: 1,
      },
    });
    expect(res.db.stages).toBeLessThanOrEqual(2);
  });

  it('keeps branch staff and teachers to what they reach; front desk and teachers see no money', async () => {
    const { member, main, albany, teacher } = await setup();
    const manager = await member('branch_manager', [albany.id]);
    const managed = (await manager.as('GET', '/reports/dashboard')).body;
    expect(managed).toMatchObject({
      families: 1,
      students: 1,
      classes: 1,
      today: { lessons: 1, cancelled: 1 },
      unmarkedLessons: 1,
      money: { owing: nzd(0), draftInvoices: 1 },
    });
    const desk = await member('front_desk', [main.id]);
    const front = (await desk.as('GET', '/reports/dashboard')).body;
    expect(front).toMatchObject({ families: 1, students: 2, today: { lessons: 1 } });
    expect(front).not.toHaveProperty('money');
    const own = (await teacher.as('GET', '/reports/dashboard')).body;
    expect(own).toMatchObject({ families: 1, students: 2, classes: 1, unmarkedLessons: 1 });
    expect(own).not.toHaveProperty('money');
  });

  it('is 403 for a parent and an accountant, and 404 for another org', async () => {
    const { member, base } = await setup();
    for (const role of ['parent', 'accountant'] as const) {
      expect((await (await member(role)).as('GET', '/reports/dashboard')).status).toBe(403);
    }
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    expect((await call('GET', `${base}/reports/dashboard`, { token: stranger.token })).status).toBe(
      404,
    );
  });
});

describe('GET /reports/money', () => {
  const range = () => `from=${addDays(today(), -10)}&to=${addDays(today(), 10)}`;

  it('reports invoiced against received, aged debt and tax', async () => {
    const { api } = await setup();
    const res = await api('GET', `/reports/money?${range()}`);
    expect(res.status).toBe(200);
    const month = today().slice(0, 7);
    expect(res.body).toMatchObject({
      invoiced: nzd(103500),
      received: nzd(20000),
      receivedByMethod: [{ method: 'cash', amount: nzd(20000) }],
      agedDebt: {
        asOf: today(),
        invoices: 1,
        total: nzd(83500),
        notDue: nzd(0),
        days31to60: nzd(83500),
      },
      tax: [
        {
          name: 'GST',
          rateBps: 1500,
          inclusive: false,
          taxable: nzd(90000),
          tax: nzd(13500),
        },
      ],
      taxTotal: nzd(13500),
    });
    const thisMonth = (res.body.byMonth as { month: string }[]).find((m) => m.month === month);
    expect(thisMonth).toEqual({ month, invoiced: nzd(103500), received: nzd(20000) });
  });

  it('keeps a branch manager to their branches, and is 403 for front desk', async () => {
    const { member, albany } = await setup();
    const manager = await member('branch_manager', [albany.id]);
    const res = await manager.as('GET', `/reports/money?${range()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ invoiced: nzd(0), received: nzd(0), taxTotal: nzd(0) });
    const accountant = await member('accountant');
    expect((await accountant.as('GET', `/reports/money?${range()}`)).body.invoiced).toEqual(
      nzd(103500),
    );
    for (const role of ['front_desk', 'teacher', 'parent'] as const) {
      expect((await (await member(role)).as('GET', `/reports/money?${range()}`)).status).toBe(403);
    }
  });

  it('refuses dates that are backwards, missing or more than a year apart', async () => {
    const { api } = await setup();
    expect(
      (await api('GET', `/reports/money?from=${today()}&to=${addDays(today(), -1)}`)).status,
    ).toBe(400);
    expect((await api('GET', `/reports/money?from=${today()}`)).status).toBe(400);
    const long = await api('GET', `/reports/money?from=${today()}&to=${addDays(today(), 366)}`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toHaveProperty('to');
    expect(
      (await api('GET', `/reports/money?from=${today()}&to=${addDays(today(), 365)}`)).status,
    ).toBe(200);
  });
});
