import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import {
  applyDiscounts,
  type Billable,
  type DiscountRuleData,
} from '../src/modules/billing/discounts';
import { call, db, newOrg, newUser } from './helpers';

// Discount rules (TUI-58): what each kind takes off, the rules' routes, and an invoice run that
// applies them.

const PERIOD = { startDate: '2026-11-02', endDate: '2026-12-18' };
const rule = (kind: DiscountRuleData['kind'], extra: Partial<DiscountRuleData> = {}) =>
  ({
    id: `dsr_${kind}`,
    name: kind,
    kind,
    percentBps: 1000,
    amount: null,
    fixedPrice: null,
    minCount: null,
    courseIds: null,
    studentIds: null,
    familyIds: null,
    cutoffDate: null,
    termId: null,
    startsOn: null,
    endsOn: null,
    active: true,
    ...extra,
  }) satisfies DiscountRuleData;
const line = (enrolmentId: string, extra: Partial<Billable> = {}): Billable => ({
  enrolmentId,
  studentId: 'stu_a',
  familyId: 'fam_a',
  courseId: 'crs_maths',
  charge: 45000,
  enrolledOn: '2026-10-01',
  ...extra,
});
const amounts = (result: ReturnType<typeof applyDiscounts>) =>
  Object.fromEntries([...result].map(([id, d]) => [id, d.amount]));
const run = { termId: 'trm_1', period: PERIOD };

describe('applyDiscounts', () => {
  it('gives a sibling discount to every child but the one charged most', () => {
    const lines = [
      line('e1', { studentId: 'stu_a', charge: 45000 }),
      line('e2', { studentId: 'stu_b', charge: 30000 }),
      line('e3', { studentId: 'stu_c', charge: 20000 }),
      line('e4', { studentId: 'stu_d', familyId: 'fam_b' }),
    ];
    expect(amounts(applyDiscounts([rule('sibling')], lines, run))).toEqual({ e2: 3000, e3: 2000 });
    expect(amounts(applyDiscounts([rule('sibling', { minCount: 4 })], lines, run))).toEqual({});
  });

  it('gives a multi-class discount on all but a student’s dearest line, bundles aside', () => {
    const lines = [
      line('e1', { charge: 30000 }),
      line('e2', { charge: 45000, courseId: 'crs_eng' }),
      line('e3', { charge: 20000, courseId: 'crs_sci' }),
    ];
    expect(amounts(applyDiscounts([rule('multi_class')], lines, run))).toEqual({
      e1: 3000,
      e3: 2000,
    });
    // A bundle of maths and English prices those two; science alone is no multi-class.
    const bundle = rule('bundle', {
      id: 'dsr_0bundle',
      percentBps: null,
      fixedPrice: 60000,
      courseIds: ['crs_maths', 'crs_eng'],
    });
    expect(amounts(applyDiscounts([rule('multi_class'), bundle], lines, run))).toEqual({
      e1: 6000,
      e2: 9000,
    });
  });

  it('prices a bundle at its fixed total only when the student takes every course in it', () => {
    const bundle = rule('bundle', {
      percentBps: null,
      fixedPrice: 80000,
      courseIds: ['crs_maths', 'crs_eng', 'crs_sci'],
    });
    const two = [line('e1'), line('e2', { courseId: 'crs_eng' })];
    expect(amounts(applyDiscounts([bundle], two, run))).toEqual({});
    const three = [...two, line('e3', { courseId: 'crs_sci', charge: 30000 })];
    // 45000 + 45000 + 30000 = 120000, so 40000 off, split by charge.
    expect(amounts(applyDiscounts([bundle], three, run))).toEqual({
      e1: 15000,
      e2: 15000,
      e3: 10000,
    });
  });

  it('gives early-bird, scholarship and manual discounts to whom they name', () => {
    const lines = [
      line('e1', { enrolledOn: '2026-09-30' }),
      line('e2', { studentId: 'stu_b', familyId: 'fam_b', enrolledOn: '2026-10-15' }),
    ];
    const early = rule('early_bird', { cutoffDate: '2026-10-01' });
    expect(amounts(applyDiscounts([early], lines, run))).toEqual({ e1: 4500 });
    expect(amounts(applyDiscounts([{ ...early, termId: 'trm_other' }], lines, run))).toEqual({});
    const scholarship = rule('scholarship', { percentBps: 10_000, studentIds: ['stu_b'] });
    expect(amounts(applyDiscounts([scholarship], lines, run))).toEqual({ e2: 45000 });
    const manual = rule('manual', { percentBps: null, amount: 5000, familyIds: ['fam_a'] });
    expect(amounts(applyDiscounts([manual], lines, run))).toEqual({ e1: 5000 });
  });

  it('adds rules up to the whole charge, and skips paused or out-of-date rules', () => {
    const lines = [line('e1', { charge: 10000 })];
    const big = rule('manual', { percentBps: null, amount: 8000, familyIds: ['fam_a'] });
    const more = rule('scholarship', { id: 'dsr_z', percentBps: 5000, studentIds: ['stu_a'] });
    const result = applyDiscounts([big, more], lines, run);
    expect(result.get('e1')).toEqual({
      amount: 10000,
      applied: [
        { ruleId: 'dsr_manual', name: 'manual', amount: 8000 },
        { ruleId: 'dsr_z', name: 'scholarship', amount: 2000 },
      ],
    });
    expect(amounts(applyDiscounts([{ ...big, active: false }], lines, run))).toEqual({});
    expect(amounts(applyDiscounts([{ ...big, endsOn: '2026-11-01' }], lines, run))).toEqual({});
    expect(amounts(applyDiscounts([{ ...big, startsOn: '2026-12-19' }], lines, run))).toEqual({});
  });
});

// ── The routes, and a run ───────────────────────────────────────────────────

const nextMonday = () => {
  const today = localNow('Pacific/Auckland').date;
  return addDays(today, 8 - weekday(today));
};
type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

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
  const member = async (role: Role) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: user.userId,
        role,
        branchIds: null,
      });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  return { org, base, api, make, member };
}

describe('discount rules', () => {
  it('adds, lists, updates and deletes a rule, with audit rows', async () => {
    const { api } = await setup();
    const created = await api('POST', '/discount-rules', {
      name: 'Sibling 10%',
      kind: 'sibling',
      percentBps: 1000,
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^dsr_/),
      name: 'Sibling 10%',
      kind: 'sibling',
      percentBps: 1000,
      amount: null,
      fixedPrice: null,
      minCount: null,
      courseIds: null,
      studentIds: null,
      familyIds: null,
      cutoffDate: null,
      termId: null,
      startsOn: null,
      endsOn: null,
      active: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await api('GET', '/discount-rules')).body.data).toEqual([created.body]);
    expect((await api('GET', '/discount-rules?kind=bundle')).body.data).toEqual([]);

    const id = created.body.id as string;
    const changed = await api('PATCH', `/discount-rules/${id}`, {
      updatedAt: created.body.updatedAt,
      percentBps: null,
      amount: { amount: 2000, currency: 'NZD' },
      minCount: 3,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      percentBps: null,
      amount: { amount: 2000, currency: 'NZD' },
      minCount: 3,
    });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'discount_rule.updated',
      before: { percentBps: 1000, amount: null, minCount: null },
      after: { percentBps: null, amount: 2000, minCount: 3 },
    });
    const stale = await api('PATCH', `/discount-rules/${id}`, {
      updatedAt: created.body.updatedAt,
      active: false,
    });
    expect(stale.status).toBe(409);
    // Both a percentage and an amount: not allowed.
    const both = await api('PATCH', `/discount-rules/${id}`, {
      updatedAt: changed.body.updatedAt,
      percentBps: 500,
    });
    expect(both.status).toBe(400);

    expect((await api('DELETE', `/discount-rules/${id}`)).status).toBe(204);
    expect((await api('DELETE', `/discount-rules/${id}`)).status).toBe(404);
    expect((await api('GET', '/discount-rules')).body.data).toEqual([]);
  });

  it('refuses a rule that doesn’t suit its kind, or money in another currency', async () => {
    const { api } = await setup();
    const post = (body: Record<string, unknown>) => api('POST', '/discount-rules', body);
    const none = await post({ name: 'x', kind: 'sibling' });
    expect(none.status).toBe(400);
    expect(none.body.error.fields).toHaveProperty('_');
    expect(
      (await post({ name: 'x', kind: 'early_bird', percentBps: 500 })).body.error.fields,
    ).toHaveProperty('cutoffDate');
    expect((await post({ name: 'x', kind: 'scholarship', percentBps: 500 })).status).toBe(400);
    expect(
      (await post({ name: 'x', kind: 'bundle', percentBps: 500, courseIds: ['a'] })).status,
    ).toBe(400);
    expect(
      (
        await post({
          name: 'x',
          kind: 'sibling',
          fixedPrice: { amount: 100, currency: 'NZD' },
        })
      ).body.error.fields,
    ).toHaveProperty('fixedPrice');
    const currency = await post({
      name: 'x',
      kind: 'sibling',
      amount: { amount: 100, currency: 'AUD' },
    });
    expect(currency.status).toBe(400);
    expect(currency.body.error.fields).toHaveProperty(['amount.currency']);
    expect(
      (
        await post({
          name: 'x',
          kind: 'early_bird',
          percentBps: 5,
          cutoffDate: '2026-10-01',
          termId: 'trm_missing',
        })
      ).status,
    ).toBe(404);
  });

  it('is read by billing staff and written by the owner alone', async () => {
    const { api, member } = await setup();
    const body = { name: 'Sibling', kind: 'sibling', percentBps: 1000 };
    const rule = (await api('POST', '/discount-rules', body)).body;
    for (const role of ['branch_manager', 'front_desk', 'accountant'] as const) {
      const someone = await member(role);
      expect((await someone.as('GET', '/discount-rules')).status).toBe(200);
      expect((await someone.as('POST', '/discount-rules', body)).status).toBe(403);
      expect(
        (await someone.as('PATCH', `/discount-rules/${rule.id}`, { updatedAt: rule.updatedAt }))
          .status,
      ).toBe(403);
      expect((await someone.as('DELETE', `/discount-rules/${rule.id}`)).status).toBe(403);
    }
    for (const role of ['teacher', 'parent'] as const) {
      expect((await (await member(role)).as('GET', '/discount-rules')).status).toBe(403);
    }
    const other = await setup();
    expect(
      (await other.api('PATCH', `/discount-rules/${rule.id}`, { updatedAt: rule.updatedAt }))
        .status,
    ).toBe(404);
  });

  it('take their share off an invoice run’s lines, before tax', async () => {
    const { api, make } = await setup();
    const main = (await api('GET', '/branches')).body.data[0] as Row;
    const subject = await make('/subjects', { name: 'Mathematics' });
    const grade = await make('/grade-levels', { name: 'Year 10' });
    const course = await make('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      defaultPrice: { amount: 45000, currency: 'NZD' },
    });
    await make('/tax-rates', { name: 'GST', rateBps: 1500, inclusive: false, isDefault: true });
    const start = nextMonday();
    const year = await make('/academic-years', {
      name: 'Year',
      startDate: addDays(start, -30),
      endDate: addDays(start, 300),
    });
    const term = await make('/terms', {
      academicYearId: year.id,
      name: 'Term 1',
      startDate: start,
      endDate: addDays(start, 69),
    });
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name: 'Group A',
    });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    const family = await make('/families', { name: 'Perera', branchId: main.id });
    for (const firstName of ['Aroha', 'Sam']) {
      const student = await make('/students', {
        familyId: family.id,
        firstName,
        lastName: 'Perera',
      });
      await make('/enrolments', { studentId: student.id, classId: klass.id });
    }
    await make('/discount-rules', { name: 'Sibling 10%', kind: 'sibling', percentBps: 1000 });

    const started = await api('POST', `/terms/${term.id}/generate-invoices`, {});
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${started.body.jobId}`)).body;
      if (job.status === 'succeeded') break;
      if (job.status === 'failed') throw new Error(job.error);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const [invoice] = (await api('GET', `/invoices?familyId=${family.id}`)).body.data;
    const lines = invoice.lines as {
      studentFirstName: string;
      discount: { amount: number };
      discounts: { name: string; amount: { amount: number } }[];
      subtotal: { amount: number };
      tax: { amount: number };
    }[];
    // Both children are charged the same, so the first by id pays in full and the other gets 10%.
    const discounted = lines.filter((l) => l.discount.amount > 0);
    expect(discounted).toHaveLength(1);
    expect(discounted[0]).toMatchObject({
      discount: { amount: 4500 },
      discounts: [{ name: 'Sibling 10%', amount: { amount: 4500 } }],
      subtotal: { amount: 40500 },
      tax: { amount: 6075 },
    });
    expect(invoice.subtotal.amount).toBe(85500);
    expect(invoice.total.amount).toBe(85500 + 6750 + 6075);
  });
});
