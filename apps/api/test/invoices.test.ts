import { guardians, invoiceLines, jobs, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { runJob } from '../src/background/jobs';
import { chargeFor, divRound, monthRange, withTax } from '../src/modules/billing/invoicing';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency
const nextMonth = (month: string) => {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
};

type Money = { amount: number; currency: string };
type Row = { id: string; updatedAt: string };
type Class = Row & { name: string; branchId: string };
type Student = Row & { familyId: string; firstName: string; lastName: string };
type Family = Row & { name: string; bankReference: string };
type Enrolment = Row & { studentId: string; classId: string };
type Line = {
  id: string;
  enrolmentId: string;
  studentFirstName: string;
  basis: string;
  unitPrice: Money;
  quantity: number;
  lessons: number;
  periodLessons: number | null;
  freeLessons: number;
  subtotal: Money;
  tax: Money;
  total: Money;
};
type Invoice = Row & {
  familyId: string;
  familyName: string;
  status: string;
  termId: string | null;
  month: string | null;
  bankReference: string | null;
  dueDate: string | null;
  notes: string | null;
  total: Money;
  lines: Line[];
  issuedAt: string | null;
  voidedAt: string | null;
};
type RunResult = {
  termId: string | null;
  month: string | null;
  invoices: number;
  lines: number;
  total: Money;
  alreadyInvoiced: number;
  skipped: { enrolmentId: string; studentId: string; classId: string; reason: string }[];
};
type Job = {
  id: string;
  status: string;
  attempts: number;
  error: string | null;
  result: RunResult;
};
type As = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => ReturnType<typeof call>;

const MON = { weekday: 1, startTime: '16:00', endTime: '17:00' };
const TERM_PRICE = 45000;

/**
 * An owner with a fresh org that has what an invoice needs: a course charged $450 a term (or a
 * month, for a class with no term), the Main branch and a ten-week term starting next Monday,
 * with helpers to add classes, families, students, enrolments and prices, and to run invoices.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body, headers) =>
    call(method, `${base}${path}`, { token: owner.token, body, headers });
  const make = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make<Row>('/subjects', { name: 'Mathematics' });
  const grade = await make<Row>('/grade-levels', { name: 'Year 10' });
  const course = await make<Row>('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(TERM_PRICE),
  });
  const start = nextMonday();
  const end = addDays(start, 69);
  const year = await make<Row>('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make<Row>('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: end,
  });

  const setSchedule = async (classId: string, slots: (typeof MON)[]) => {
    const res = await api('PUT', `/classes/${classId}/schedule`, { slots });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
  };
  /** A class in the term with a lesson every Monday: ten lessons, billed per term. */
  const addClass = async (body: Record<string, unknown> = {}, slots = [MON]) => {
    const klass = await make<Class>('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name: 'Group A',
      ...body,
    });
    if (slots.length > 0) await setSchedule(klass.id, slots);
    return klass;
  };
  /** A class with no term and a lesson every Monday from next Monday on, billed monthly. */
  const addOpenClass = (body: Record<string, unknown> = {}) =>
    addClass({ termId: null, startDate: start, name: 'Rolling group', ...body });
  const addFamily = (name = 'Perera', body: Record<string, unknown> = {}) =>
    make<Family>('/families', { name, branchId: main.id, ...body });
  const addStudent = (familyId: string, body: Record<string, unknown> = {}) =>
    make<Student>('/students', { familyId, firstName: 'Aroha', lastName: 'Perera', ...body });
  const enrol = (studentId: string, classId: string, body: Record<string, unknown> = {}) =>
    make<Enrolment>('/enrolments', { studentId, classId, ...body });
  /** A family with one child enrolled in the class. */
  const enrolled = async (classId: string, name = 'Perera', body: Record<string, unknown> = {}) => {
    const family = await addFamily(name);
    const student = await addStudent(family.id, { lastName: name });
    return { family, student, enrolment: await enrol(student.id, classId, body) };
  };
  const addRule = (body: Record<string, unknown>) => make<Row>('/price-rules', body);
  const addTaxRate = (name: string, rateBps: number, inclusive: boolean, isDefault = true) =>
    make<Row>('/tax-rates', { name, rateBps, inclusive, isDefault });
  /** A member of the org with the given role, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body, headers) =>
      call(method, `${base}${path}`, { token: user.token, body, headers });
    return { id, userId: user.userId, as };
  };

  /** Polls a job until the queue consumer has run it, as a client would. */
  const finished = async (jobId: string, as: As = api) => {
    for (let i = 0; i < 400; i++) {
      const job = (await as('GET', `/jobs/${jobId}`)).body as Job;
      if (job.status === 'succeeded' || job.status === 'failed') return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`job ${jobId} did not finish`);
  };
  /** Starts a run and waits for it. */
  const run = async (path: string, body: unknown, as: As = api) => {
    const res = await as('POST', path, body);
    if (res.status !== 202) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    const job = await finished(res.body.jobId as string, as);
    if (job.status !== 'succeeded') throw new Error(`run failed: ${job.error}`);
    return job;
  };
  const runTerm = (as: As = api, body: unknown = {}) =>
    run(`/terms/${term.id}/generate-invoices`, body, as);
  const runMonth = (month: string, as: As = api) =>
    run('/invoices/generate-monthly', { month }, as);

  const invoices = async (as: As = api, query = '') =>
    (await as('GET', `/invoices${query}`)).body.data as Invoice[];
  const invoiceOf = async (familyId: string, as: As = api) => {
    const [invoice, ...more] = await invoices(as, `?familyId=${familyId}`);
    if (!invoice || more.length > 0) throw new Error(`expected one invoice for ${familyId}`);
    return invoice;
  };
  /** The dates of a class's lessons between two days. */
  const lessonDates = async (classId: string, from: string, to: string) =>
    (
      (await api('GET', `/sessions?classId=${classId}&from=${from}&to=${to}&limit=200`)).body
        .data as { date: string }[]
    ).map((session) => session.date);
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityType: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
    }[];

  return {
    owner,
    org,
    base,
    api,
    make,
    main,
    subject,
    grade,
    course,
    term,
    start,
    end,
    addClass,
    addOpenClass,
    addFamily,
    addStudent,
    enrol,
    enrolled,
    addRule,
    addTaxRate,
    member,
    finished,
    runTerm,
    runMonth,
    invoices,
    invoiceOf,
    lessonDates,
    lastAudit,
  };
}

describe('generating a term’s invoices', () => {
  it('makes one draft invoice per family, with a line per enrolment and the tax split out', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const gst = await s.addTaxRate('GST', 1500, true);
    const perera = await s.addFamily('Perera');
    const aroha = await s.addStudent(perera.id, { firstName: 'Aroha' });
    const kai = await s.addStudent(perera.id, { firstName: 'Kai' });
    const first = await s.enrol(aroha.id, klass.id);
    const second = await s.enrol(kai.id, klass.id);
    const silva = await s.enrolled(klass.id, 'Silva');
    const due = addDays(s.start, 14);

    const started = await s.api('POST', `/terms/${s.term.id}/generate-invoices`, { dueDate: due });
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ jobId: expect.stringMatching(/^job_/) });
    const job = await s.finished(started.body.jobId);

    expect(job).toMatchObject({ status: 'succeeded', attempts: 1, error: null });
    expect(job.result).toEqual({
      termId: s.term.id,
      month: null,
      periodStart: s.start,
      periodEnd: s.end,
      invoices: 2,
      lines: 3,
      total: nzd(3 * TERM_PRICE),
      alreadyInvoiced: 0,
      skipped: [],
    });

    // $450 including 15% GST is $391.30 plus $58.70.
    const line = {
      id: expect.stringMatching(/^inl_/),
      studentLastName: 'Perera',
      classId: klass.id,
      className: 'Group A',
      courseId: s.course.id,
      basis: 'per_term',
      unitPrice: nzd(TERM_PRICE),
      quantity: 1,
      lessons: 10,
      periodLessons: 10,
      freeLessons: 0,
      priceSource: 'course_default',
      priceRuleId: null,
      priceOverridden: false,
      taxRateId: gst.id,
      taxName: 'GST',
      taxRateBps: 1500,
      taxInclusive: true,
      subtotal: nzd(39130),
      tax: nzd(5870),
      total: nzd(TERM_PRICE),
    };
    const invoice = await s.invoiceOf(perera.id);
    expect(invoice).toEqual({
      id: expect.stringMatching(/^inv_/),
      familyId: perera.id,
      familyName: 'Perera',
      branchId: s.main.id,
      status: 'draft',
      termId: s.term.id,
      month: null,
      periodStart: s.start,
      periodEnd: s.end,
      bankReference: perera.bankReference,
      dueDate: due,
      notes: null,
      subtotal: nzd(78260),
      tax: nzd(11740),
      total: nzd(90000),
      lines: [
        { ...line, enrolmentId: first.id, studentId: aroha.id, studentFirstName: 'Aroha' },
        { ...line, enrolmentId: second.id, studentId: kai.id, studentFirstName: 'Kai' },
      ],
      issuedAt: null,
      voidedAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await s.api('GET', `/invoices/${invoice.id}`)).body).toEqual(invoice);
    expect((await s.invoiceOf(silva.family.id)).total).toEqual(nzd(TERM_PRICE));
    expect(await s.invoices()).toHaveLength(2);

    // One audit row for the whole run, after the one for starting the job.
    expect(await s.lastAudit(2)).toMatchObject([
      {
        action: 'invoice.generated',
        entityType: 'job',
        entityId: job.id,
        actorUserId: s.owner.userId,
        after: {
          termId: s.term.id,
          month: null,
          invoices: 2,
          lines: 3,
          total: 3 * TERM_PRICE,
          currency: 'NZD',
        },
      },
      { action: 'job.started', entityType: 'job', entityId: job.id },
    ]);
  });

  it('gives each family its bank reference, the same on every invoice', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const other = await s.addClass({ name: 'Group B' });
    const perera = await s.enrolled(klass.id, 'Perera');
    const silva = await s.enrolled(klass.id, 'Silva');
    await s.runTerm();
    await s.enrol(perera.student.id, other.id);
    await s.runTerm();

    expect(perera.family.bankReference).toMatch(/^[0-9A-Z]{8}$/);
    expect(perera.family.bankReference).toBe(perera.family.id.slice(-8).toUpperCase());
    expect(perera.family.bankReference).not.toBe(silva.family.bankReference);
    const references = (await s.invoices()).map((i) => [i.familyName, i.bankReference]);
    expect(references).toHaveLength(3);
    expect(new Set(references.map(String))).toEqual(
      new Set([
        String(['Perera', perera.family.bankReference]),
        String(['Silva', silva.family.bankReference]),
      ]),
    );
  });

  it('charges a term price pro rata by lessons for a late start or an early finish', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const late = await s.enrolled(klass.id, 'Late', { startDate: addDays(s.start, 28) });
    const early = await s.enrolled(klass.id, 'Early', { endDate: addDays(s.start, 20) });

    await s.runTerm();

    // Six of the ten Mondays, then three of them.
    expect((await s.invoiceOf(late.family.id)).lines[0]).toMatchObject({
      quantity: 1,
      lessons: 6,
      periodLessons: 10,
      total: nzd(27000),
    });
    expect((await s.invoiceOf(early.family.id)).lines[0]).toMatchObject({
      lessons: 3,
      periodLessons: 10,
      total: nzd(13500),
    });
  });

  it('doesn’t count a lesson a holiday closes', async () => {
    const s = await setup();
    await s.make('/holidays', {
      name: 'Show day',
      startDate: addDays(s.start, 7),
      endDate: addDays(s.start, 7),
    });
    const klass = await s.addClass();
    const whole = await s.enrolled(klass.id, 'Whole');
    const late = await s.enrolled(klass.id, 'Late', { startDate: addDays(s.start, 1) });

    await s.runTerm();

    // Nine lessons are held. The whole term costs the whole price; missing the first costs 8/9.
    expect((await s.invoiceOf(whole.family.id)).lines[0]).toMatchObject({
      lessons: 9,
      periodLessons: 9,
      total: nzd(TERM_PRICE),
    });
    expect((await s.invoiceOf(late.family.id)).lines[0]).toMatchObject({
      lessons: 8,
      periodLessons: 9,
      total: nzd(40000),
    });
  });

  it('charges a per-lesson price for each lesson after the free trial, with tax added', async () => {
    const s = await setup();
    const klass = await s.addClass();
    await s.addTaxRate('GST', 1500, false);
    const rule = await s.addRule({
      classId: klass.id,
      basis: 'per_lesson',
      price: nzd(4000),
      freeTrialLessons: 2,
    });
    const { family } = await s.enrolled(klass.id);

    await s.runTerm();

    const invoice = await s.invoiceOf(family.id);
    expect(invoice.lines[0]).toMatchObject({
      basis: 'per_lesson',
      unitPrice: nzd(4000),
      quantity: 8,
      lessons: 8,
      periodLessons: 10,
      freeLessons: 2,
      priceSource: 'class_rule',
      priceRuleId: rule.id,
      taxInclusive: false,
      subtotal: nzd(32000),
      tax: nzd(4800),
      total: nzd(36800),
    });
    expect(invoice).toMatchObject({
      subtotal: nzd(32000),
      tax: nzd(4800),
      total: nzd(36800),
    });
  });

  it('invoices packs up front: enough to cover the term’s lessons', async () => {
    const s = await setup();
    const klass = await s.addClass();
    await s.addRule({ classId: klass.id, basis: 'pack', price: nzd(30000), packLessons: 8 });
    const { family } = await s.enrolled(klass.id);

    await s.runTerm();

    // Ten lessons need two packs of eight.
    expect((await s.invoiceOf(family.id)).lines[0]).toMatchObject({
      basis: 'pack',
      unitPrice: nzd(30000),
      quantity: 2,
      lessons: 16,
      periodLessons: null,
      total: nzd(60000),
    });
  });

  it('charges an enrolment’s price override, and copies the price onto the line', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const rule = await s.addRule({ courseId: s.course.id, basis: 'per_term', price: nzd(50000) });
    const usual = await s.enrolled(klass.id, 'Usual');
    const scholar = await s.enrolled(klass.id, 'Scholar', { priceOverride: nzd(20000) });
    await s.runTerm();

    // Changing or deleting the rule afterwards changes nothing on the invoices.
    expect((await s.api('DELETE', `/price-rules/${rule.id}`)).status).toBe(204);

    expect((await s.invoiceOf(usual.family.id)).lines[0]).toMatchObject({
      unitPrice: nzd(50000),
      priceSource: 'course_rule',
      priceRuleId: rule.id,
      priceOverridden: false,
      total: nzd(50000),
    });
    expect((await s.invoiceOf(scholar.family.id)).lines[0]).toMatchObject({
      unitPrice: nzd(20000),
      priceSource: 'course_rule',
      priceOverridden: true,
      total: nzd(20000),
    });
  });

  it('leaves out what it can’t bill and says why', async () => {
    const s = await setup();
    const science = await s.make<Row>('/subjects', { name: 'Science' });
    const unpriced = await s.make<Row>('/courses', {
      subjectId: science.id,
      gradeLevelId: s.grade.id,
    });
    const noPrice = await s.addClass({ courseId: unpriced.id, name: 'No price' });
    const noLessons = await s.addClass({ name: 'No schedule' }, []);
    const priced = await s.addClass({ name: 'Priced' });
    const a = await s.enrolled(noPrice.id, 'A');
    const b = await s.enrolled(noLessons.id, 'B');
    const c = await s.enrolled(priced.id, 'C', { priceOverride: nzd(0) });
    const d = await s.enrolled(priced.id, 'D');

    const job = await s.runTerm();

    expect(job.result).toMatchObject({ invoices: 1, lines: 1, total: nzd(TERM_PRICE) });
    const reasons = job.result.skipped.map((skip) => [skip.enrolmentId, skip.reason]);
    expect(new Set(reasons.map(String))).toEqual(
      new Set([
        String([a.enrolment.id, 'no_price']),
        String([b.enrolment.id, 'no_lessons']),
        String([c.enrolment.id, 'free']),
      ]),
    );
    expect(job.result.skipped.find((skip) => skip.reason === 'no_price')).toEqual({
      enrolmentId: a.enrolment.id,
      studentId: a.student.id,
      classId: noPrice.id,
      reason: 'no_price',
    });
    expect((await s.invoices()).map((i) => i.familyId)).toEqual([d.family.id]);
  });

  it('writes nothing, and no audit row, when there is nothing to bill', async () => {
    const s = await setup();
    await s.addClass();

    const job = await s.runTerm();

    expect(job.result).toMatchObject({
      invoices: 0,
      lines: 0,
      total: nzd(0),
      alreadyInvoiced: 0,
      skipped: [],
    });
    expect(await s.invoices()).toEqual([]);
    expect((await s.lastAudit())[0]!.action).toBe('job.started');
  });
});

describe('generating a month’s invoices', () => {
  it('bills the classes with no term for the month, pro rata for a late start', async () => {
    const s = await setup();
    const open = await s.addOpenClass();
    const inTerm = await s.addClass();
    const month = nextMonth(s.start.slice(0, 7));
    const { startDate, endDate } = monthRange(month);
    const mondays = await s.lessonDates(open.id, startDate, endDate);
    const whole = await s.enrolled(open.id, 'Whole');
    const late = await s.enrolled(open.id, 'Late', { startDate: mondays[1] });
    await s.enrolled(inTerm.id, 'Termly');

    const job = await s.runMonth(month);

    // The class in a term isn't billed by a monthly run, so it isn't skipped either.
    expect(job.result).toMatchObject({ termId: null, month, invoices: 2, lines: 2, skipped: [] });
    expect(await s.invoiceOf(whole.family.id)).toMatchObject({
      termId: null,
      month,
      periodStart: startDate,
      periodEnd: endDate,
      total: nzd(TERM_PRICE),
      lines: [
        {
          basis: 'per_month',
          quantity: 1,
          lessons: mondays.length,
          periodLessons: mondays.length,
          tax: nzd(0),
        },
      ],
    });
    expect((await s.invoiceOf(late.family.id)).lines[0]).toMatchObject({
      lessons: mondays.length - 1,
      periodLessons: mondays.length,
      total: nzd(divRound(TERM_PRICE * (mondays.length - 1), mondays.length)),
    });

    // And a term run leaves the classes with no term alone.
    const termJob = await s.runTerm();
    expect(termJob.result).toMatchObject({ invoices: 1, lines: 1, alreadyInvoiced: 0 });
    expect(await s.invoices(s.api, `?month=${month}`)).toHaveLength(2);
    expect(await s.invoices(s.api, `?termId=${s.term.id}`)).toHaveLength(1);
  });

  it('carries a pack’s unused lessons into the next month', async () => {
    const s = await setup();
    const open = await s.addOpenClass();
    await s.addRule({ classId: open.id, basis: 'pack', price: nzd(50000), packLessons: 20 });
    const { family, enrolment } = await s.enrolled(open.id);
    const first = s.start.slice(0, 7);

    const one = await s.runMonth(first);
    const two = await s.runMonth(nextMonth(first));

    // Two months hold ten lessons at most, so one pack of twenty covers both.
    expect(one.result).toMatchObject({ invoices: 1, total: nzd(50000) });
    expect(two.result).toMatchObject({
      invoices: 0,
      alreadyInvoiced: 0,
      skipped: [{ enrolmentId: enrolment.id, reason: 'pack_covers' }],
    });
    expect((await s.invoiceOf(family.id)).lines[0]).toMatchObject({
      basis: 'pack',
      quantity: 1,
      lessons: 20,
    });
  });

  it('rejects a month that isn’t one with 400', async () => {
    const { api } = await setup();
    const results = await Promise.all([
      api('POST', '/invoices/generate-monthly', { month: '2026-13' }),
      api('POST', '/invoices/generate-monthly', { month: '2026-1' }),
      api('POST', '/invoices/generate-monthly', {}),
      api('POST', '/invoices/generate-monthly'),
      api('POST', '/invoices/generate-monthly', { month: '2026-11', dueDate: '20/11/2026' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(Object.keys(results[0]!.body.error.fields)).toEqual(['month']);
    expect(Object.keys(results[4]!.body.error.fields)).toEqual(['dueDate']);
  });
});

describe('running it twice', () => {
  it('bills an enrolment once for a period, however often the run is repeated', async () => {
    const s = await setup();
    const klass = await s.addClass();
    await s.enrolled(klass.id, 'Perera');
    await s.enrolled(klass.id, 'Silva');

    const first = await s.runTerm();
    const again = await s.runTerm();

    expect(first.result).toMatchObject({ invoices: 2, lines: 2, alreadyInvoiced: 0 });
    expect(again.result).toMatchObject({ invoices: 0, lines: 0, alreadyInvoiced: 2, skipped: [] });
    expect(await s.invoices()).toHaveLength(2);
    // The second run wrote nothing, so the only audit row since is for starting it.
    expect((await s.lastAudit(3)).map((e) => e.action)).toEqual([
      'job.started',
      'invoice.generated',
      'job.started',
    ]);
  });

  it('makes nothing new when the queue delivers a finished job’s work again', async () => {
    const s = await setup();
    const klass = await s.addClass();
    await s.enrolled(klass.id, 'Perera');
    await s.enrolled(klass.id, 'Silva');
    const first = await s.runTerm();

    // As if the job's last update was lost after its invoices were written: it runs again whole.
    await db().update(jobs).set({ status: 'queued' }).where(eq(jobs.id, first.id));
    await runJob(db(), env, { orgId: s.org.id, jobId: first.id }, 2);

    const retried = await s.finished(first.id);
    expect(retried).toMatchObject({ status: 'succeeded', attempts: 2 });
    // The result still counts what the job made, and none of it as someone else's.
    expect(retried.result).toEqual(first.result);
    expect(await s.invoices()).toHaveLength(2);
    expect((await s.lastAudit(2)).map((e) => e.action)).toEqual([
      'invoice.generated',
      'job.started',
    ]);
  });

  it('is also held by the database: a second line for an enrolment and period is refused', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const { family } = await s.enrolled(klass.id);
    await s.runTerm();
    const line = (await db().query.invoiceLines.findFirst({
      where: (l, { eq }) => eq(l.orgId, s.org.id),
    }))!;
    const copy = { ...line, id: newId('invoiceLine') };

    await expect(db().insert(invoiceLines).values(copy)).rejects.toThrow();

    // Voiding the invoice frees the enrolment.
    const invoice = await s.invoiceOf(family.id);
    expect((await s.api('POST', `/invoices/${invoice.id}/void`)).status).toBe(200);
    await db().insert(invoiceLines).values(copy);
  });

  it('bills only what is new: a later enrolment gets an invoice of its own', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const other = await s.addClass({ name: 'Group B' });
    const { family, student } = await s.enrolled(klass.id);
    await s.runTerm();
    const added = await s.enrol(student.id, other.id);

    const job = await s.runTerm();

    expect(job.result).toMatchObject({ invoices: 1, lines: 1, alreadyInvoiced: 1 });
    const both = await s.invoices(s.api, `?familyId=${family.id}`);
    expect(both).toHaveLength(2);
    // Newest first.
    expect(both[0]!.lines.map((l) => l.enrolmentId)).toEqual([added.id]);
  });

  it('bills an enrolment again once its invoice is void', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const { family } = await s.enrolled(klass.id);
    await s.runTerm();
    const wrong = await s.invoiceOf(family.id);
    await s.api('POST', `/invoices/${wrong.id}/void`);

    const job = await s.runTerm();

    expect(job.result).toMatchObject({ invoices: 1, lines: 1, alreadyInvoiced: 0 });
    const statuses = (await s.invoices(s.api, `?familyId=${family.id}`)).map((i) => i.status);
    expect(statuses).toEqual(['draft', 'void']);
  });

  it('replays the first answer for a retry with the same Idempotency-Key', async () => {
    const s = await setup();
    const klass = await s.addClass();
    await s.enrolled(klass.id);
    const headers = { 'Idempotency-Key': crypto.randomUUID() };
    const path = `/terms/${s.term.id}/generate-invoices`;

    const first = await s.api('POST', path, {}, headers);
    const retry = await s.api('POST', path, {}, headers);
    await s.finished(first.body.jobId);

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    const started = await db().query.jobs.findMany({ where: (j, { eq }) => eq(j.orgId, s.org.id) });
    expect(started).toHaveLength(1);
  });
});

describe('an invoice', () => {
  /** A family with one draft invoice for the term. */
  async function withInvoice() {
    const s = await setup();
    const klass = await s.addClass();
    const { family } = await s.enrolled(klass.id);
    await s.runTerm();
    return { ...s, klass, family, invoice: await s.invoiceOf(family.id) };
  }

  it('takes a due date and a note, with an audit row', async () => {
    const { api, owner, invoice, start, lastAudit } = await withInvoice();
    const dueDate = addDays(start, 10);

    const patched = await api('PATCH', `/invoices/${invoice.id}`, {
      updatedAt: invoice.updatedAt,
      dueDate,
      notes: '  Thank you  ',
    });

    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({
      ...invoice,
      dueDate,
      notes: 'Thank you',
      updatedAt: expect.any(String),
    });
    expect(patched.body.updatedAt).not.toBe(invoice.updatedAt);
    expect((await lastAudit())[0]).toMatchObject({
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoice.id,
      actorUserId: owner.userId,
      before: { dueDate: null, notes: null },
      after: { dueDate, notes: 'Thank you' },
    });

    const cleared = await api('PATCH', `/invoices/${invoice.id}`, {
      updatedAt: patched.body.updatedAt,
      dueDate: null,
      notes: null,
    });
    expect(cleared.body).toMatchObject({ dueDate: null, notes: null });
  });

  it('returns 409 for a stale updatedAt, 400 for a bad body, and itself when nothing changes', async () => {
    const { api, invoice } = await withInvoice();
    const path = `/invoices/${invoice.id}`;

    const same = await api('PATCH', path, { updatedAt: invoice.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(invoice);

    const bad = await Promise.all([
      api('PATCH', path, { notes: 'No updatedAt' }),
      api('PATCH', path, { updatedAt: invoice.updatedAt, dueDate: 'tomorrow' }),
      api('PATCH', path, { updatedAt: invoice.updatedAt, notes: 'x'.repeat(2001) }),
    ]);
    expect(bad.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(bad.map((r) => Object.keys(r.body.error.fields))).toEqual([
      ['updatedAt'],
      ['dueDate'],
      ['notes'],
    ]);

    await api('PATCH', path, { updatedAt: invoice.updatedAt, notes: 'First' });
    const stale = await api('PATCH', path, { updatedAt: invoice.updatedAt, notes: 'Second' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('is issued once, with an audit row', async () => {
    const { api, owner, invoice, lastAudit } = await withInvoice();

    const issued = await api('POST', `/invoices/${invoice.id}/issue`);

    expect(issued.status).toBe(200);
    expect(issued.body).toEqual({
      ...invoice,
      status: 'issued',
      issuedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await lastAudit())[0]).toMatchObject({
      action: 'invoice.issued',
      entityType: 'invoice',
      entityId: invoice.id,
      actorUserId: owner.userId,
      before: { status: 'draft', issuedAt: null },
      after: { status: 'issued', issuedAt: issued.body.issuedAt },
    });

    const again = await api('POST', `/invoices/${invoice.id}/issue`);
    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({
      code: 'unprocessable',
      fields: { status: ['Not a draft'] },
    });
    // An issued invoice still takes a new due date.
    const patched = await api('PATCH', `/invoices/${invoice.id}`, {
      updatedAt: issued.body.updatedAt,
      dueDate: '2030-01-31',
    });
    expect(patched.body).toMatchObject({ status: 'issued', dueDate: '2030-01-31' });
  });

  it('is voided as a draft or once issued, and can’t be changed or issued after', async () => {
    const { api, owner, invoice, lastAudit } = await withInvoice();
    await api('POST', `/invoices/${invoice.id}/issue`);

    const voided = await api('POST', `/invoices/${invoice.id}/void`);

    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({
      id: invoice.id,
      status: 'void',
      issuedAt: expect.any(String),
      voidedAt: expect.any(String),
      total: invoice.total,
    });
    expect(voided.body.lines).toEqual(invoice.lines);
    expect((await lastAudit())[0]).toMatchObject({
      action: 'invoice.voided',
      entityType: 'invoice',
      entityId: invoice.id,
      actorUserId: owner.userId,
      before: { status: 'issued' },
      after: { status: 'void', voidedAt: voided.body.voidedAt },
    });

    const after = await Promise.all([
      api('POST', `/invoices/${invoice.id}/void`),
      api('POST', `/invoices/${invoice.id}/issue`),
      api('PATCH', `/invoices/${invoice.id}`, {
        updatedAt: voided.body.updatedAt,
        notes: 'Too late',
      }),
    ]);
    expect(after.map((r) => r.status)).toEqual([422, 422, 422]);
    expect(after.map((r) => r.body.error.fields.status)).toEqual([
      ['Already void'],
      ['Not a draft'],
      ['Void'],
    ]);
  });

  it('replays an issue sent twice with the same Idempotency-Key', async () => {
    const { api, invoice } = await withInvoice();
    const headers = { 'Idempotency-Key': crypto.randomUUID() };

    const first = await api('POST', `/invoices/${invoice.id}/issue`, undefined, headers);
    const retry = await api('POST', `/invoices/${invoice.id}/issue`, undefined, headers);

    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
  });

  it('returns 404 for an invoice that doesn’t exist', async () => {
    const { api } = await withInvoice();
    const results = await Promise.all([
      api('GET', '/invoices/inv_nope'),
      api('PATCH', '/invoices/inv_nope', { updatedAt: new Date().toISOString() }),
      api('POST', '/invoices/inv_nope/issue'),
      api('POST', '/invoices/inv_nope/void'),
      api('POST', '/terms/trm_nope/generate-invoices'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  });
});

describe('listing invoices', () => {
  it('filters by family, home branch, period and status, and pages newest first', async () => {
    const s = await setup();
    const albany = await s.make<Row>('/branches', { name: 'Albany' });
    const klass = await s.addClass();
    const open = await s.addOpenClass();
    const perera = await s.enrolled(klass.id, 'Perera');
    const silva = await s.addFamily('Silva', { branchId: albany.id });
    const mia = await s.addStudent(silva.id, { firstName: 'Mia', lastName: 'Silva' });
    await s.enrol(mia.id, klass.id);
    await s.enrol(mia.id, open.id);
    const month = nextMonth(s.start.slice(0, 7));
    await s.runTerm();
    await s.runMonth(month);
    const issued = await s.invoiceOf(perera.family.id);
    await s.api('POST', `/invoices/${issued.id}/issue`);
    const families = async (query: string) =>
      (await s.invoices(s.api, query)).map((i) => i.familyName).sort();

    expect(await families('')).toEqual(['Perera', 'Silva', 'Silva']);
    expect(await families(`?familyId=${silva.id}`)).toEqual(['Silva', 'Silva']);
    expect(await families(`?branchId=${albany.id}`)).toEqual(['Silva', 'Silva']);
    expect(await families(`?branchId=${s.main.id}`)).toEqual(['Perera']);
    expect(await families(`?termId=${s.term.id}`)).toEqual(['Perera', 'Silva']);
    expect(await families(`?month=${month}`)).toEqual(['Silva']);
    expect(await families('?status=issued')).toEqual(['Perera']);
    expect(await families('?status=draft')).toEqual(['Silva', 'Silva']);
    expect(await families(`?status=draft&termId=${s.term.id}`)).toEqual(['Silva']);
    expect(await families('?status=void')).toEqual([]);

    const all = await s.invoices();
    expect(all.map((i) => i.id)).toEqual(
      all
        .map((i) => i.id)
        .sort()
        .reverse(),
    );
    const one = await s.api('GET', '/invoices?limit=2');
    expect(one.body.data.map((i: Invoice) => i.id)).toEqual(all.slice(0, 2).map((i) => i.id));
    const two = await s.api('GET', `/invoices?limit=2&cursor=${one.body.nextCursor}`);
    expect(two.body.data.map((i: Invoice) => i.id)).toEqual([all[2]!.id]);
    expect(two.body.nextCursor).toBeNull();
  });

  it('returns 404 for a filter id the org doesn’t have, and 400 for a bad filter', async () => {
    const { api } = await setup();
    const results = await Promise.all([
      api('GET', '/invoices?familyId=fam_nope'),
      api('GET', '/invoices?branchId=brn_nope'),
      api('GET', '/invoices?termId=trm_nope'),
      api('GET', '/invoices?status=overdue'),
      api('GET', '/invoices?month=2026-13'),
      api('GET', '/invoices?limit=0'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 400, 400, 400]);
  });

  it('names the first unknown filter, in the order family, term, branch', async () => {
    // The filters are checked together now (TUI-97). The one reported is still the first.
    const { api } = await setup();
    const messages: string[] = [];
    for (const query of [
      'familyId=fam_nope&termId=trm_nope&branchId=brn_nope',
      'termId=trm_nope&branchId=brn_nope',
      'branchId=brn_nope',
    ]) {
      const res = await api('GET', `/invoices?${query}`);
      expect(res.status).toBe(404);
      messages.push(res.body.error.message);
    }
    expect(messages).toEqual(['Family not found', 'Term not found', 'Branch not found']);
  });
});

describe('org isolation', () => {
  it("can't read, change or bill another org's records through any route", async () => {
    const alice = await setup();
    const klass = await alice.addClass();
    const { family } = await alice.enrolled(klass.id);
    await alice.runTerm();
    const invoice = await alice.invoiceOf(family.id);
    const bob = await setup();
    const asBob = (method: string, path: string, body?: unknown) =>
      call(method, `${alice.base}${path}`, { token: bob.owner.token, body });

    const results = await Promise.all([
      bob.api('GET', `/invoices/${invoice.id}`),
      bob.api('PATCH', `/invoices/${invoice.id}`, { updatedAt: invoice.updatedAt, notes: 'Hi' }),
      bob.api('POST', `/invoices/${invoice.id}/issue`),
      bob.api('POST', `/invoices/${invoice.id}/void`),
      bob.api('GET', `/invoices?familyId=${family.id}`),
      bob.api('GET', `/invoices?termId=${alice.term.id}`),
      bob.api('GET', `/invoices?branchId=${alice.main.id}`),
      bob.api('POST', `/terms/${alice.term.id}/generate-invoices`),
      asBob('GET', '/invoices'),
      asBob('GET', `/invoices/${invoice.id}`),
      asBob('POST', `/invoices/${invoice.id}/void`),
      asBob('POST', `/terms/${alice.term.id}/generate-invoices`),
      asBob('POST', '/invoices/generate-monthly', { month: '2026-11' }),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));

    expect(await bob.invoices()).toEqual([]);
    expect(await alice.invoiceOf(family.id)).toEqual(invoice);
  });

  it('bills only its own org, even for the same month', async () => {
    const alice = await setup();
    const bob = await setup();
    const month = nextMonth(alice.start.slice(0, 7));
    await alice.enrolled((await alice.addOpenClass()).id, 'Alice family');
    await bob.enrolled((await bob.addOpenClass()).id, 'Bob family');

    const job = await alice.runMonth(month);

    expect(job.result).toMatchObject({ invoices: 1, lines: 1 });
    expect((await alice.invoices()).map((i) => i.familyName)).toEqual(['Alice family']);
    expect(await bob.invoices()).toEqual([]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk'] as Role[])(
    '%s can generate, read, change, issue and void invoices',
    async (role) => {
      const s = await setup();
      const klass = await s.addClass();
      const { family } = await s.enrolled(klass.id);
      const staff = await s.member(role);

      const job = await s.runTerm(staff.as);
      expect(job.result).toMatchObject({ invoices: 1 });
      const invoice = await s.invoiceOf(family.id, staff.as);
      const patched = await staff.as('PATCH', `/invoices/${invoice.id}`, {
        updatedAt: invoice.updatedAt,
        notes: 'From the desk',
      });
      const issued = await staff.as('POST', `/invoices/${invoice.id}/issue`);
      const voided = await staff.as('POST', `/invoices/${invoice.id}/void`);
      expect([patched.status, issued.status, voided.status]).toEqual([200, 200, 200]);

      // The audit rows name the staff member, the run's included.
      expect((await s.lastAudit(5)).map((e) => [e.action, e.actorUserId])).toEqual([
        ['invoice.voided', staff.userId],
        ['invoice.issued', staff.userId],
        ['invoice.updated', staff.userId],
        ['invoice.generated', staff.userId],
        ['job.started', staff.userId],
      ]);
    },
  );

  it('accountant can read every invoice but not generate or change any', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const { family } = await s.enrolled(klass.id);
    await s.runTerm();
    const invoice = await s.invoiceOf(family.id);
    const accountant = await s.member('accountant');

    expect(await s.invoices(accountant.as)).toEqual([invoice]);
    expect((await accountant.as('GET', `/invoices/${invoice.id}`)).body).toEqual(invoice);
    const writes = await Promise.all([
      accountant.as('POST', `/terms/${s.term.id}/generate-invoices`),
      accountant.as('POST', '/invoices/generate-monthly', { month: '2026-11' }),
      accountant.as('PATCH', `/invoices/${invoice.id}`, {
        updatedAt: invoice.updatedAt,
        notes: 'No',
      }),
      accountant.as('POST', `/invoices/${invoice.id}/issue`),
      accountant.as('POST', `/invoices/${invoice.id}/void`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await s.invoiceOf(family.id)).toEqual(invoice);
  });

  it('teacher has no access to invoices at all', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const { family } = await s.enrolled(klass.id);
    await s.runTerm();
    const invoice = await s.invoiceOf(family.id);
    const teacher = await s.member('teacher');

    const results = await Promise.all([
      teacher.as('GET', '/invoices'),
      teacher.as('GET', `/invoices/${invoice.id}`),
      teacher.as('POST', `/terms/${s.term.id}/generate-invoices`),
      teacher.as('POST', '/invoices/generate-monthly', { month: '2026-11' }),
      teacher.as('PATCH', `/invoices/${invoice.id}`, { updatedAt: invoice.updatedAt }),
      teacher.as('POST', `/invoices/${invoice.id}/issue`),
      teacher.as('POST', `/invoices/${invoice.id}/void`),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 403));
    expect(results[0]!.body.error.code).toBe('forbidden');
  });

  it('parent reads their own family’s invoices once issued, and changes nothing', async () => {
    const s = await setup();
    const klass = await s.addClass();
    const mine = await s.enrolled(klass.id, 'Mine');
    const theirs = await s.enrolled(klass.id, 'Theirs');
    const parent = await s.member('parent');
    const guardian = await s.make<Row>(`/families/${mine.family.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Mine',
    });
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, guardian.id));
    await s.runTerm();
    const own = await s.invoiceOf(mine.family.id);
    const other = await s.invoiceOf(theirs.family.id);
    await s.api('POST', `/invoices/${other.id}/issue`);

    // A draft isn't theirs to see yet.
    expect(await s.invoices(parent.as)).toEqual([]);
    expect((await parent.as('GET', `/invoices/${own.id}`)).status).toBe(404);

    const issued = (await s.api('POST', `/invoices/${own.id}/issue`)).body as Invoice;
    expect(await s.invoices(parent.as)).toEqual([issued]);
    expect((await parent.as('GET', `/invoices/${own.id}`)).body).toEqual(issued);
    const hidden = await Promise.all([
      parent.as('GET', `/invoices/${other.id}`),
      parent.as('GET', `/invoices?familyId=${theirs.family.id}`),
    ]);
    expect(hidden.map((r) => r.status)).toEqual([404, 404]);

    const writes = await Promise.all([
      parent.as('POST', `/terms/${s.term.id}/generate-invoices`),
      parent.as('POST', '/invoices/generate-monthly', { month: '2026-11' }),
      parent.as('PATCH', `/invoices/${own.id}`, { updatedAt: issued.updatedAt, notes: 'Paid!' }),
      parent.as('POST', `/invoices/${own.id}/issue`),
      parent.as('POST', `/invoices/${own.id}/void`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);

    // One that was issued and then voided stays visible, as void.
    await s.api('POST', `/invoices/${own.id}/void`);
    expect((await s.invoices(parent.as)).map((i) => i.status)).toEqual(['void']);
  });

  it('staff limited to a branch bill and reach only the families whose home branch it is', async () => {
    const s = await setup();
    const albany = await s.make<Row>('/branches', { name: 'Albany' });
    const klass = await s.addClass();
    // Both children are in a Main class; only the Silvas' home branch is Albany.
    const perera = await s.enrolled(klass.id, 'Perera');
    const silva = await s.addFamily('Silva', { branchId: albany.id });
    const mia = await s.addStudent(silva.id, { firstName: 'Mia', lastName: 'Silva' });
    await s.enrol(mia.id, klass.id);
    const desk = await s.member('front_desk', [albany.id]);

    const job = await s.runTerm(desk.as);

    expect(job.result).toMatchObject({
      invoices: 1,
      lines: 1,
      skipped: [{ enrolmentId: perera.enrolment.id, reason: 'other_branch' }],
    });
    expect((await s.invoices(desk.as)).map((i) => i.familyName)).toEqual(['Silva']);

    // The owner bills the rest. Albany's desk still sees only its own family's invoice.
    const rest = await s.runTerm();
    expect(rest.result).toMatchObject({ invoices: 1, alreadyInvoiced: 1, skipped: [] });
    const pereras = await s.invoiceOf(perera.family.id);
    expect((await s.invoices(desk.as)).map((i) => i.familyName)).toEqual(['Silva']);
    expect(await s.invoices(desk.as, `?branchId=${s.main.id}`)).toEqual([]);
    const hidden = await Promise.all([
      desk.as('GET', `/invoices/${pereras.id}`),
      desk.as('GET', `/invoices?familyId=${perera.family.id}`),
      desk.as('PATCH', `/invoices/${pereras.id}`, { updatedAt: pereras.updatedAt, notes: 'Hi' }),
      desk.as('POST', `/invoices/${pereras.id}/issue`),
      desk.as('POST', `/invoices/${pereras.id}/void`),
    ]);
    expect(hidden.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await s.invoiceOf(perera.family.id)).toEqual(pereras);

    // Main's manager is the other way round, and a manager with no branch limit sees both.
    const manager = await s.member('branch_manager', [s.main.id]);
    expect((await s.invoices(manager.as)).map((i) => i.familyName)).toEqual(['Perera']);
    const everywhere = await s.member('branch_manager');
    expect(await s.invoices(everywhere.as)).toHaveLength(2);
  });
});

describe('API docs', () => {
  it('documents the invoice routes', async () => {
    const spec = await call('GET', '/api/openapi.json');
    const org = '/api/v1/orgs/{orgId}';
    expect(spec.body.paths[`${org}/terms/{termId}/generate-invoices`].post).toBeDefined();
    expect(spec.body.paths[`${org}/invoices/generate-monthly`].post).toBeDefined();
    expect(Object.keys(spec.body.paths[`${org}/invoices`])).toEqual(['get']);
    expect(Object.keys(spec.body.paths[`${org}/invoices/{invoiceId}`]).sort()).toEqual([
      'get',
      'patch',
    ]);
    expect(spec.body.paths[`${org}/invoices/{invoiceId}/issue`].post).toBeDefined();
    expect(spec.body.paths[`${org}/invoices/{invoiceId}/void`].post).toBeDefined();
    expect(spec.body.components.schemas.Invoice.required).toEqual(
      expect.arrayContaining(['status', 'bankReference', 'total', 'lines']),
    );
    // A run's result is read from its job, so its shape is in the docs too.
    expect(spec.body.components.schemas.InvoiceRunResult.required).toEqual(
      expect.arrayContaining(['invoices', 'lines', 'total', 'alreadyInvoiced', 'skipped']),
    );
  });
});

describe('what an enrolment owes', () => {
  const mondays = (count: number, from = '2026-02-02') =>
    Array.from({ length: count }, (_, week) => addDays(from, 7 * week));
  const term = { startDate: '2026-02-02', endDate: '2026-04-12' };
  const whole = { startDate: '2026-02-02', endDate: null };
  const priced = (basis: 'per_term' | 'per_month' | 'per_lesson' | 'pack', amount: number) => ({
    basis,
    price: nzd(amount),
    packLessons: basis === 'pack' ? 10 : null,
    freeTrialLessons: 0,
  });

  it('charges the whole price for the whole period', () => {
    expect(
      chargeFor({
        price: priced('per_term', 45000),
        period: term,
        enrolment: whole,
        lessonDates: mondays(10),
      }),
    ).toEqual({
      basis: 'per_term',
      unitAmount: 45000,
      quantity: 1,
      lessons: 10,
      periodLessons: 10,
      freeLessons: 0,
      amount: 45000,
    });
  });

  it.each([
    [10000, 1, 3, 3333],
    [10000, 2, 3, 6667],
    [5, 1, 2, 3],
    [45000, 6, 10, 27000],
  ])('rounds %i × %i/%i lessons to %i, halves up', (price, covered, held, amount) => {
    const dates = mondays(held);
    const charge = chargeFor({
      price: priced('per_term', price),
      period: term,
      enrolment: { startDate: dates[held - covered]!, endDate: null },
      lessonDates: dates,
    });
    expect(charge).toMatchObject({ lessons: covered, periodLessons: held, amount });
  });

  it('takes the free trial off the enrolment’s first lessons, whichever period they are in', () => {
    const price = { ...priced('per_term', 45000), freeTrialLessons: 2 };
    const dates = mondays(10);

    // Both trial lessons fall in this term.
    expect(chargeFor({ price, period: term, enrolment: whole, lessonDates: dates })).toMatchObject({
      lessons: 8,
      freeLessons: 2,
      amount: 36000,
    });
    // One was used the week before the term, so one is left.
    expect(
      chargeFor({
        price,
        period: term,
        enrolment: { startDate: '2026-01-26', endDate: null },
        lessonDates: ['2026-01-26', ...dates],
      }),
    ).toMatchObject({ lessons: 9, periodLessons: 10, freeLessons: 1, amount: 40500 });
    // A trial as long as the enrolment leaves nothing to pay.
    expect(
      chargeFor({
        price,
        period: term,
        enrolment: { startDate: dates[8]!, endDate: null },
        lessonDates: dates,
      }),
    ).toBe('free_trial');
  });

  it('charges a per-lesson price for each lesson the enrolment covers', () => {
    expect(
      chargeFor({
        price: priced('per_lesson', 4000),
        period: term,
        enrolment: { startDate: '2026-02-02', endDate: '2026-02-23' },
        lessonDates: mondays(10),
      }),
    ).toMatchObject({ quantity: 4, lessons: 4, periodLessons: 10, amount: 16000 });
  });

  it('invoices packs up front and carries what is left into later periods', () => {
    const price = priced('pack', 35000);
    const march = { startDate: '2026-03-01', endDate: '2026-03-31' };
    const april = { startDate: '2026-04-01', endDate: '2026-04-30' };
    const dates = mondays(13); // 2 Feb to 27 Apr: four in February, five in March, four in April

    // Twelve lessons to the end of a longer term need two packs of ten.
    expect(
      chargeFor({
        price,
        period: { startDate: '2026-02-02', endDate: '2026-04-26' },
        enrolment: whole,
        lessonDates: mondays(12),
      }),
    ).toMatchObject({ quantity: 2, lessons: 20, periodLessons: null, amount: 70000 });
    // Nine lessons by the end of March are covered by the pack bought in February.
    expect(
      chargeFor({
        price,
        period: march,
        enrolment: whole,
        lessonDates: dates.filter((d) => d <= march.endDate),
        packLessonsBought: 10,
      }),
    ).toBe('pack_covers');
    // Thirteen by the end of April aren't, so April invoices the next pack.
    expect(
      chargeFor({
        price,
        period: april,
        enrolment: whole,
        lessonDates: dates,
        packLessonsBought: 10,
      }),
    ).toMatchObject({ quantity: 1, lessons: 10, amount: 35000 });
  });

  it('doesn’t use a pack for free-trial lessons, or for periods paid for another way', () => {
    const march = { startDate: '2026-03-01', endDate: '2026-03-31' };
    const dates = mondays(9); // four in February, five in March

    // The trial takes two of the nine, and February was invoiced per month.
    expect(
      chargeFor({
        price: { ...priced('pack', 35000), packLessons: 5, freeTrialLessons: 2 },
        period: march,
        enrolment: whole,
        lessonDates: dates,
        paidPeriods: [{ startDate: '2026-02-01', endDate: '2026-02-28' }],
      }),
    ).toMatchObject({ quantity: 1, lessons: 5, freeLessons: 0, amount: 35000 });
    expect(
      chargeFor({
        price: { ...priced('pack', 35000), packLessons: 5, freeTrialLessons: 2 },
        period: march,
        enrolment: whole,
        lessonDates: dates,
      }),
    ).toMatchObject({ quantity: 2, lessons: 10 });
  });

  it('owes nothing with no lessons to cover, or at a price of 0', () => {
    const input = { period: term, enrolment: whole, lessonDates: mondays(10) };
    expect(chargeFor({ ...input, price: priced('per_term', 0) })).toBe('free');
    expect(chargeFor({ ...input, price: priced('per_term', 45000), lessonDates: [] })).toBe(
      'no_lessons',
    );
    // Lessons are held, but none on the days the enrolment covers.
    expect(
      chargeFor({
        ...input,
        price: priced('per_lesson', 4000),
        enrolment: { startDate: '2026-02-03', endDate: '2026-02-08' },
      }),
    ).toBe('no_lessons');
  });

  it('splits out tax that is inside the price, and adds tax that isn’t', () => {
    expect(withTax(45000, null)).toEqual({ subtotal: 45000, tax: 0, total: 45000 });
    expect(withTax(45000, { rateBps: 1500, inclusive: true })).toEqual({
      subtotal: 39130,
      tax: 5870,
      total: 45000,
    });
    expect(withTax(45000, { rateBps: 1500, inclusive: false })).toEqual({
      subtotal: 45000,
      tax: 6750,
      total: 51750,
    });
    expect(withTax(45000, { rateBps: 0, inclusive: false })).toEqual({
      subtotal: 45000,
      tax: 0,
      total: 45000,
    });
    // 12.5% of $0.99 is 12.375 cents.
    expect(withTax(99, { rateBps: 1250, inclusive: false }).tax).toBe(12);
  });

  it('knows a month’s first and last day', () => {
    expect(monthRange('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });
});
