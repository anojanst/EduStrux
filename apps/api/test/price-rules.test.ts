import { memberships, priceRules } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import type { PricedEnrolment } from '../src/modules/billing/pricing';
import { loadPricing } from '../src/modules/billing/service';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency

type Money = { amount: number; currency: string };
type Row = { id: string; updatedAt: string };
type Course = Row & { defaultPrice: Money | null };
type Class = Row & { courseId: string; termId: string | null; branchId: string };
type Rule = Row & {
  courseId: string | null;
  classId: string | null;
  basis: string;
  price: Money;
  packLessons: number | null;
  freeTrialLessons: number;
  taxRateId: string | null;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

const PER_LESSON = { basis: 'per_lesson', price: nzd(4000) };

/**
 * An owner with a fresh org that has what a price needs: a course with no default price, the
 * Main branch and a ten-week term starting next Monday, with helpers to add classes and rules.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make<Row>('/subjects', { name: 'Mathematics' });
  const grade = await make<Row>('/grade-levels', { name: 'Year 10' });
  const course = await make<Course>('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const start = nextMonday();
  const year = await make<Row>('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make<Row>('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: addDays(start, 69),
  });

  /** A class in the term, billed per term. */
  const addClass = (body: Record<string, unknown> = {}) =>
    make<Class>('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name: 'Group A',
      ...body,
    });
  /** A class with no term, billed monthly. */
  const addOpenClass = (body: Record<string, unknown> = {}) =>
    make<Class>('/classes', {
      courseId: course.id,
      branchId: main.id,
      name: 'Rolling group',
      startDate: start,
      ...body,
    });
  const addRule = (body: Record<string, unknown> = PER_LESSON) => make<Rule>('/price-rules', body);
  const addTaxRate = (name: string, rateBps: number, isDefault = false) =>
    make<Row>('/tax-rates', { name, rateBps, inclusive: true, isDefault });
  const rules = async (as: As = api, query = '') =>
    (await as('GET', `/price-rules${query}`)).body.data as Rule[];
  /** A member of the org with the given role, optionally limited to some branches. */
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { userId: user.userId, as };
  };
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityId: string;
      actorUserId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
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
    addClass,
    addOpenClass,
    addRule,
    addTaxRate,
    rules,
    member,
    lastAudit,
  };
}

describe('price rules', () => {
  it('starts with none', async () => {
    const { api } = await setup();
    const res = await api('GET', '/price-rules');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it('adds an org-wide rule, lists, updates and deletes it, with audit rows', async () => {
    const { owner, api, rules, lastAudit } = await setup();

    const res = await api('POST', '/price-rules', PER_LESSON);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^prr_/),
      courseId: null,
      classId: null,
      basis: 'per_lesson',
      price: nzd(4000),
      packLessons: null,
      freeTrialLessons: 0,
      taxRateId: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await rules()).toEqual([res.body]);

    const updated = await api('PATCH', `/price-rules/${res.body.id}`, {
      updatedAt: res.body.updatedAt,
      price: nzd(4500),
      freeTrialLessons: 2,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ price: nzd(4500), freeTrialLessons: 2 });
    expect(await rules()).toEqual([updated.body]);

    const deleted = await api('DELETE', `/price-rules/${res.body.id}`);
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeNull();
    expect(await rules()).toEqual([]);

    const audit = await lastAudit(3);
    expect(audit.map((e) => [e.action, e.entityId, e.actorUserId])).toEqual([
      ['price_rule.deleted', res.body.id, owner.userId],
      ['price_rule.updated', res.body.id, owner.userId],
      ['price_rule.created', res.body.id, owner.userId],
    ]);
    expect(audit[1]!.before).toMatchObject({ priceAmount: 4000, freeTrialLessons: 0 });
    expect(audit[1]!.after).toEqual({
      priceAmount: 4500,
      priceCurrency: 'NZD',
      freeTrialLessons: 2,
    });
    expect(audit[2]!.after).toMatchObject({ basis: 'per_lesson', priceAmount: 4000 });
  });

  it('prices a course or a class, and filters the list by either', async () => {
    const { course, addClass, addRule, rules } = await setup();
    const klass = await addClass();
    const orgWide = await addRule();
    const forCourse = await addRule({ courseId: course.id, basis: 'per_term', price: nzd(45000) });
    const forClass = await addRule({ classId: klass.id, basis: 'per_term', price: nzd(40000) });

    expect(forCourse).toMatchObject({ courseId: course.id, classId: null, basis: 'per_term' });
    expect(forClass).toMatchObject({ courseId: null, classId: klass.id, price: nzd(40000) });
    // Oldest first.
    expect((await rules()).map((r) => r.id)).toEqual([orgWide.id, forCourse.id, forClass.id]);
    expect(await rules(undefined, `?courseId=${course.id}`)).toEqual([forCourse]);
    expect(await rules(undefined, `?classId=${klass.id}`)).toEqual([forClass]);
  });

  it('pages with a cursor', async () => {
    const { api, course, addClass, addRule } = await setup();
    const klass = await addClass();
    const ids = [
      (await addRule()).id,
      (await addRule({ ...PER_LESSON, courseId: course.id })).id,
      (await addRule({ ...PER_LESSON, classId: klass.id })).id,
    ];

    const first = await api('GET', '/price-rules?limit=2');
    expect(first.body.data.map((r: Rule) => r.id)).toEqual(ids.slice(0, 2));
    const second = await api('GET', `/price-rules?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.data.map((r: Rule) => r.id)).toEqual(ids.slice(2));
    expect(second.body.nextCursor).toBeNull();
    expect((await api('GET', '/price-rules?limit=0')).status).toBe(400);
  });

  it('stores a pack, a free trial, a free price and a tax rate', async () => {
    const { api, addRule, addTaxRate } = await setup();
    const gst = await addTaxRate('GST', 1500);
    const pack = await addRule({
      basis: 'pack',
      price: nzd(0),
      packLessons: 10,
      freeTrialLessons: 1,
      taxRateId: gst.id,
    });
    expect(pack).toMatchObject({
      basis: 'pack',
      price: nzd(0),
      packLessons: 10,
      freeTrialLessons: 1,
      taxRateId: gst.id,
    });

    const resized = await api('PATCH', `/price-rules/${pack.id}`, {
      updatedAt: pack.updatedAt,
      packLessons: 20,
      taxRateId: null,
    });
    expect(resized.status).toBe(200);
    expect(resized.body).toMatchObject({ packLessons: 20, taxRateId: null });
  });

  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['basis', 'price']],
    [{ ...PER_LESSON, basis: 'weekly' }, ['basis']],
    [{ ...PER_LESSON, price: 4000 }, ['price']],
    [{ ...PER_LESSON, price: nzd(-1) }, ['price.amount']],
    [{ ...PER_LESSON, price: nzd(40.5) }, ['price.amount']],
    [{ ...PER_LESSON, price: { amount: 4000, currency: 'nzd' } }, ['price.currency']],
    [{ ...PER_LESSON, courseId: 'crs_a', classId: 'cls_a' }, ['classId']],
    [{ ...PER_LESSON, packLessons: 10 }, ['packLessons']],
    [{ ...PER_LESSON, basis: 'pack' }, ['packLessons']],
    [{ ...PER_LESSON, basis: 'pack', packLessons: 1 }, ['packLessons']],
    [{ ...PER_LESSON, basis: 'pack', packLessons: 201 }, ['packLessons']],
    [{ ...PER_LESSON, freeTrialLessons: -1 }, ['freeTrialLessons']],
    [{ ...PER_LESSON, freeTrialLessons: 21 }, ['freeTrialLessons']],
    [{ ...PER_LESSON, freeTrialLessons: 1.5 }, ['freeTrialLessons']],
    [{ ...PER_LESSON, taxRateId: 15 }, ['taxRateId']],
  ])('rejects %j with 400', async (body, fields) => {
    const { api } = await setup();
    const res = await api('POST', '/price-rules', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(fields);
  });

  it('rejects a price that is not in the organisation’s currency with 400', async () => {
    const { api, addRule } = await setup();
    const usd = { amount: 4000, currency: 'USD' };

    const created = await api('POST', '/price-rules', { ...PER_LESSON, price: usd });
    expect(created.status).toBe(400);
    expect(created.body.error.fields).toEqual({
      'price.currency': ["Must be the organisation's currency, NZD"],
    });

    const rule = await addRule();
    const updated = await api('PATCH', `/price-rules/${rule.id}`, {
      updatedAt: rule.updatedAt,
      price: usd,
    });
    expect(updated.status).toBe(400);
    expect(Object.keys(updated.body.error.fields)).toEqual(['price.currency']);
  });

  it('returns 404 for a course, class or tax rate that is unknown or deleted', async () => {
    const { api, make, subject, grade, addClass, addTaxRate, addRule, rules } = await setup();
    const course = await make<Row>('/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      curriculum: 'Cambridge',
    });
    const klass = await addClass();
    const rate = await addTaxRate('GST', 1500);
    for (const path of [`/courses/${course.id}`, `/classes/${klass.id}`, `/tax-rates/${rate.id}`]) {
      expect((await api('DELETE', path)).status).toBe(204);
    }
    const rule = await addRule();

    const results = await Promise.all([
      api('POST', '/price-rules', { ...PER_LESSON, courseId: 'crs_nope' }),
      api('POST', '/price-rules', { ...PER_LESSON, courseId: course.id }),
      api('POST', '/price-rules', { ...PER_LESSON, courseId: '' }),
      api('POST', '/price-rules', { ...PER_LESSON, classId: 'cls_nope' }),
      api('POST', '/price-rules', { ...PER_LESSON, classId: klass.id }),
      api('POST', '/price-rules', { ...PER_LESSON, classId: '' }),
      api('POST', '/price-rules', { ...PER_LESSON, taxRateId: 'txr_nope' }),
      api('POST', '/price-rules', { ...PER_LESSON, taxRateId: rate.id }),
      api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, taxRateId: rate.id }),
      api('GET', `/price-rules?courseId=${course.id}`),
      api('GET', `/price-rules?classId=${klass.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));
    expect(await rules()).toEqual([rule]);
  });

  it('refuses a basis the class is not billed on with 422', async () => {
    const { api, addClass, addOpenClass } = await setup();
    const inTerm = await addClass();
    const open = await addOpenClass();
    const rule = (classId: string, basis: string) =>
      api('POST', '/price-rules', { classId, basis, price: nzd(45000) });

    const monthlyInTerm = await rule(inTerm.id, 'per_month');
    expect(monthlyInTerm.status).toBe(422);
    expect(monthlyInTerm.body.error.fields).toEqual({ basis: ['The class is in a term'] });
    const termlyOpen = await rule(open.id, 'per_term');
    expect(termlyOpen.status).toBe(422);
    expect(termlyOpen.body.error.fields).toEqual({ basis: ['The class has no term'] });

    expect((await rule(inTerm.id, 'per_term')).status).toBe(201);
    expect((await rule(open.id, 'per_month')).status).toBe(201);
  });

  it('refuses a second rule that would price the same classes with 409', async () => {
    const { api, course, addClass } = await setup();
    const klass = await addClass();
    const add = (body: Record<string, unknown>) =>
      api('POST', '/price-rules', { price: nzd(4000), ...body });

    // A term price and a monthly price sit side by side: no class is billed both ways.
    expect((await add({ basis: 'per_term' })).status).toBe(201);
    expect((await add({ basis: 'per_month' })).status).toBe(201);
    for (const basis of ['per_term', 'per_month', 'per_lesson', 'pack']) {
      const res = await add({ basis, packLessons: basis === 'pack' ? 10 : undefined });
      expect(res.status).toBe(409);
      expect(res.body.error.fields).toEqual({ _: ['Taken'] });
    }

    // Each course and each class has rules of its own.
    const perLesson = await add({ basis: 'per_lesson', courseId: course.id });
    expect(perLesson.status).toBe(201);
    expect((await add({ basis: 'per_term', courseId: course.id })).status).toBe(409);
    expect((await add({ basis: 'pack', packLessons: 5, classId: klass.id })).status).toBe(201);
    expect((await add({ basis: 'per_term', classId: klass.id })).status).toBe(409);

    // Deleting a rule frees its place.
    expect((await api('DELETE', `/price-rules/${perLesson.body.id}`)).status).toBe(204);
    expect((await add({ basis: 'per_term', courseId: course.id })).status).toBe(201);
  });

  it('is also unique in the database', async () => {
    const { org, course, addRule } = await setup();
    await addRule({ basis: 'per_term', price: nzd(45000), courseId: course.id });
    const insert = (basis: 'per_term' | 'per_month' | 'per_lesson', courseId: string | null) =>
      db()
        .insert(priceRules)
        .values({
          id: newId('priceRule'),
          orgId: org.id,
          courseId,
          basis,
          priceAmount: 1,
          priceCurrency: 'NZD',
        })
        .then(
          () => 'inserted',
          // Drizzle wraps the D1 error, so the constraint is named in the cause.
          (e: Error) => String(e.cause),
        );

    expect(await insert('per_term', course.id)).toMatch(/UNIQUE constraint failed/);
    expect(await insert('per_lesson', course.id)).toMatch(/UNIQUE constraint failed/);
    expect(await insert('per_month', course.id)).toBe('inserted');
    // "No course and no class" counts as a target too.
    expect(await insert('per_lesson', null)).toBe('inserted');
    expect(await insert('per_month', null)).toMatch(/UNIQUE constraint failed/);
  });

  it('keeps what a rule prices and its basis: a PATCH can’t change them', async () => {
    const { api, course, addClass, addRule } = await setup();
    const klass = await addClass();
    const rule = await addRule({ courseId: course.id, basis: 'per_term', price: nzd(45000) });

    const res = await api('PATCH', `/price-rules/${rule.id}`, {
      updatedAt: rule.updatedAt,
      courseId: null,
      classId: klass.id,
      basis: 'per_lesson',
      price: nzd(46000),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      courseId: course.id,
      classId: null,
      basis: 'per_term',
      price: nzd(46000),
    });
  });

  it('rejects an invalid PATCH with 400', async () => {
    const { api, addRule } = await setup();
    const rule = await addRule();
    const patch = (body: Record<string, unknown>) => api('PATCH', `/price-rules/${rule.id}`, body);

    const results = await Promise.all([
      patch({ price: nzd(5000) }),
      patch({ updatedAt: rule.updatedAt, price: nzd(-1) }),
      patch({ updatedAt: rule.updatedAt, freeTrialLessons: 21 }),
      patch({ updatedAt: rule.updatedAt, packLessons: null }),
      // Only a pack has lessons, and this rule is per lesson.
      patch({ updatedAt: rule.updatedAt, packLessons: 10 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(results.map((r) => Object.keys(r.body.error.fields))).toEqual([
      ['updatedAt'],
      ['price.amount'],
      ['freeTrialLessons'],
      ['packLessons'],
      ['packLessons'],
    ]);
  });

  it('returns 409 for a stale updatedAt, and the rule unchanged for an empty PATCH', async () => {
    const { api, addRule } = await setup();
    const rule = await addRule();

    const same = await api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body).toEqual(rule);

    await api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, price: nzd(1) });
    const stale = await api('PATCH', `/price-rules/${rule.id}`, {
      updatedAt: rule.updatedAt,
      price: nzd(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');
  });

  it('returns 404 for a rule that is unknown or deleted', async () => {
    const { api, addRule } = await setup();
    const rule = await addRule();
    await api('DELETE', `/price-rules/${rule.id}`);

    const results = await Promise.all([
      api('PATCH', '/price-rules/prr_nope', { updatedAt: rule.updatedAt, price: nzd(1) }),
      api('DELETE', '/price-rules/prr_nope'),
      api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, price: nzd(1) }),
      api('DELETE', `/price-rules/${rule.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });
});

describe('what a price rule points at', () => {
  it('refuses to delete a tax rate a rule names, until the rule lets go of it', async () => {
    const { api, addRule, addTaxRate } = await setup();
    const gst = await addTaxRate('GST', 1500);
    const rule = await addRule({ ...PER_LESSON, taxRateId: gst.id });

    const refused = await api('DELETE', `/tax-rates/${gst.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toBe(
      '1 price rule(s) use this tax rate. Change them first.',
    );

    await api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, taxRateId: null });
    expect((await api('DELETE', `/tax-rates/${gst.id}`)).status).toBe(204);
  });

  it('refuses to delete a course or a class that has a price rule', async () => {
    const { api, course, addClass, addRule } = await setup();
    const klass = await addClass();
    const forClass = await addRule({ ...PER_LESSON, classId: klass.id });

    const classRefused = await api('DELETE', `/classes/${klass.id}`);
    expect(classRefused.status).toBe(422);
    expect(classRefused.body.error.message).toBe("Delete this class's price rule first.");
    await api('DELETE', `/price-rules/${forClass.id}`);
    expect((await api('DELETE', `/classes/${klass.id}`)).status).toBe(204);

    const forCourse = await addRule({ ...PER_LESSON, courseId: course.id });
    const courseRefused = await api('DELETE', `/courses/${course.id}`);
    expect(courseRefused.status).toBe(422);
    expect(courseRefused.body.error.message).toBe("Delete this course's 1 price rule(s) first.");
    await api('DELETE', `/price-rules/${forCourse.id}`);
    expect((await api('DELETE', `/courses/${course.id}`)).status).toBe(204);
  });
});

describe('org isolation', () => {
  it("can't read, change or point at another org's records through any route", async () => {
    const alice = await setup();
    const klass = await alice.addClass();
    const gst = await alice.addTaxRate('GST', 1500);
    const rule = await alice.addRule();
    const bob = await setup();

    const results = await Promise.all([
      bob.api('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, price: nzd(1) }),
      bob.api('DELETE', `/price-rules/${rule.id}`),
      call('GET', `${alice.base}/price-rules`, { token: bob.owner.token }),
      call('POST', `${alice.base}/price-rules`, { token: bob.owner.token, body: PER_LESSON }),
      bob.api('POST', '/price-rules', { ...PER_LESSON, courseId: alice.course.id }),
      bob.api('POST', '/price-rules', { ...PER_LESSON, classId: klass.id }),
      bob.api('POST', '/price-rules', { ...PER_LESSON, taxRateId: gst.id }),
      bob.api('GET', `/price-rules?courseId=${alice.course.id}`),
      bob.api('GET', `/price-rules?classId=${klass.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));

    expect(await alice.rules()).toEqual([rule]);
    expect(await bob.rules()).toEqual([]);
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk'] as Role[])(
    '%s can add, change and delete price rules',
    async (role) => {
      const { member, rules, lastAudit } = await setup();
      const staff = await member(role);

      const created = await staff.as('POST', '/price-rules', PER_LESSON);
      expect(created.status).toBe(201);
      const updated = await staff.as('PATCH', `/price-rules/${created.body.id}`, {
        updatedAt: created.body.updatedAt,
        price: nzd(4200),
      });
      expect(updated.status).toBe(200);
      expect(await rules(staff.as)).toEqual([updated.body]);
      expect((await staff.as('DELETE', `/price-rules/${created.body.id}`)).status).toBe(204);

      // The audit rows name the staff member, not the owner.
      expect((await lastAudit(3)).map((e) => [e.action, e.actorUserId])).toEqual([
        ['price_rule.deleted', staff.userId],
        ['price_rule.updated', staff.userId],
        ['price_rule.created', staff.userId],
      ]);
    },
  );

  it('accountant can read price rules but not change them', async () => {
    const { addRule, member, rules } = await setup();
    const rule = await addRule();
    const accountant = await member('accountant');

    expect(await rules(accountant.as)).toEqual([rule]);
    const writes = await Promise.all([
      accountant.as('POST', '/price-rules', { ...PER_LESSON, basis: 'pack', packLessons: 10 }),
      accountant.as('PATCH', `/price-rules/${rule.id}`, {
        updatedAt: rule.updatedAt,
        price: nzd(1),
      }),
      accountant.as('DELETE', `/price-rules/${rule.id}`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  // A parent's billing:read is for their own invoices; a teacher has no billing access at all.
  it.each(['teacher', 'parent'] as Role[])('%s can’t read or change price rules', async (role) => {
    const { addRule, member, rules } = await setup();
    const rule = await addRule();
    const { as } = await member(role);

    const results = await Promise.all([
      as('GET', '/price-rules'),
      as('POST', '/price-rules', { ...PER_LESSON, basis: 'pack', packLessons: 10 }),
      as('PATCH', `/price-rules/${rule.id}`, { updatedAt: rule.updatedAt, price: nzd(1) }),
      as('DELETE', `/price-rules/${rule.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(results[0]!.body.error.code).toBe('forbidden');
    expect(await rules()).toEqual([rule]);
  });

  it('staff limited to a branch reach every rule except other branches’ class rules', async () => {
    const { make, main, course, addClass, addRule, member, rules } = await setup();
    const albany = await make<Row>('/branches', { name: 'Albany' });
    const mainClass = await addClass();
    const albanyClass = await addClass({ branchId: albany.id });
    const orgWide = await addRule();
    const forAlbany = await addRule({ ...PER_LESSON, classId: albanyClass.id });
    const manager = await member('branch_manager', [main.id]);

    // The other branch's class and its rule don't exist for them.
    const hidden = await Promise.all([
      manager.as('GET', `/price-rules?classId=${albanyClass.id}`),
      manager.as('PATCH', `/price-rules/${forAlbany.id}`, {
        updatedAt: forAlbany.updatedAt,
        price: nzd(1),
      }),
      manager.as('DELETE', `/price-rules/${forAlbany.id}`),
    ]);
    expect(hidden.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(await rules(manager.as)).toEqual([orgWide]);

    // A course's rule and the org-wide one have no branch, so they are theirs to change.
    const forCourse = await manager.as('POST', '/price-rules', {
      ...PER_LESSON,
      courseId: course.id,
    });
    expect(forCourse.status).toBe(201);
    const forMain = await manager.as('POST', '/price-rules', {
      ...PER_LESSON,
      classId: mainClass.id,
    });
    expect(forMain.status).toBe(201);
    const changed = await manager.as('PATCH', `/price-rules/${orgWide.id}`, {
      updatedAt: orgWide.updatedAt,
      price: nzd(4100),
    });
    expect(changed.status).toBe(200);
    expect((await rules(manager.as)).map((r) => r.id)).toEqual([
      orgWide.id,
      forCourse.body.id,
      forMain.body.id,
    ]);

    // Albany's staff see Albany's rule, not Main's, and the owner sees them all.
    const albanyDesk = await member('front_desk', [albany.id]);
    expect((await rules(albanyDesk.as)).map((r) => r.id)).toEqual([
      orgWide.id,
      forAlbany.id,
      forCourse.body.id,
    ]);
    expect(await rules()).toHaveLength(4);
    // A rule can't be added for a class out of reach either, even once it has none.
    expect((await albanyDesk.as('DELETE', `/price-rules/${forAlbany.id}`)).status).toBe(204);
    const outOfReach = await manager.as('POST', '/price-rules', {
      ...PER_LESSON,
      classId: albanyClass.id,
    });
    expect(outOfReach.status).toBe(404);
  });
});

describe('pricing an enrolment', () => {
  /** The org's pricing as invoice generation will load it, read fresh on every call. */
  async function pricing(s: Awaited<ReturnType<typeof setup>>) {
    const ctx = { db: db(), orgId: s.org.id, actorUserId: null };
    const course = async () =>
      ((await s.api('GET', '/courses')).body.data as Course[]).find((c) => c.id === s.course.id)!;
    const priceOf = async (klass: Class, priceOverride: Money | null = null) => {
      const enrolment: PricedEnrolment = {
        classId: klass.id,
        courseId: klass.courseId,
        termId: klass.termId,
        defaultPrice: (await course()).defaultPrice,
        priceOverride,
      };
      return (await loadPricing(ctx))(enrolment);
    };
    const setDefaultPrice = async (amount: number | null) => {
      const res = await s.api('PATCH', `/courses/${s.course.id}`, {
        updatedAt: (await course()).updatedAt,
        defaultPrice: amount === null ? null : nzd(amount),
      });
      if (res.status !== 200) throw new Error(`course update failed: ${JSON.stringify(res.body)}`);
    };
    return { priceOf, setDefaultPrice };
  }

  it('has no price until something sets one', async () => {
    const s = await setup();
    const { priceOf } = await pricing(s);
    expect(await priceOf(await s.addClass())).toBeNull();
  });

  it('uses the most specific price: class rule, course rule, course default, org-wide rule', async () => {
    const s = await setup();
    const { priceOf, setDefaultPrice } = await pricing(s);
    const klass = await s.addClass();
    const other = await s.addClass({ name: 'Group B' });

    const orgWide = await s.addRule();
    expect(await priceOf(klass)).toEqual({
      price: nzd(4000),
      basis: 'per_lesson',
      packLessons: null,
      freeTrialLessons: 0,
      taxRateId: null,
      source: 'org_rule',
      priceRuleId: orgWide.id,
      overridden: false,
    });

    await setDefaultPrice(45000);
    expect(await priceOf(klass)).toEqual({
      price: nzd(45000),
      basis: 'per_term',
      packLessons: null,
      freeTrialLessons: 0,
      taxRateId: null,
      source: 'course_default',
      priceRuleId: null,
      overridden: false,
    });

    const forCourse = await s.addRule({
      courseId: s.course.id,
      basis: 'per_term',
      price: nzd(48000),
    });
    expect(await priceOf(klass)).toMatchObject({
      price: nzd(48000),
      source: 'course_rule',
      priceRuleId: forCourse.id,
    });

    const forClass = await s.addRule({
      classId: klass.id,
      basis: 'pack',
      price: nzd(35000),
      packLessons: 10,
      freeTrialLessons: 1,
    });
    expect(await priceOf(klass)).toMatchObject({
      price: nzd(35000),
      basis: 'pack',
      packLessons: 10,
      freeTrialLessons: 1,
      source: 'class_rule',
      priceRuleId: forClass.id,
    });
    // The class's rule is its own: the course's other class keeps the course's rule.
    expect(await priceOf(other)).toMatchObject({ source: 'course_rule' });
  });

  it('charges a default price per term for a class in a term, per month for one with none', async () => {
    const s = await setup();
    const { priceOf, setDefaultPrice } = await pricing(s);
    await setDefaultPrice(20000);

    expect(await priceOf(await s.addClass())).toMatchObject({
      price: nzd(20000),
      basis: 'per_term',
    });
    expect(await priceOf(await s.addOpenClass())).toMatchObject({
      price: nzd(20000),
      basis: 'per_month',
    });
  });

  it('lets a term price and a monthly price each cover their own kind of class', async () => {
    const s = await setup();
    const { priceOf, setDefaultPrice } = await pricing(s);
    const inTerm = await s.addClass();
    const open = await s.addOpenClass();
    await s.addRule({ courseId: s.course.id, basis: 'per_term', price: nzd(45000) });
    const monthly = await s.addRule({ basis: 'per_month', price: nzd(18000) });

    expect(await priceOf(inTerm)).toMatchObject({ basis: 'per_term', source: 'course_rule' });
    // The course's term price doesn't fit a class with no term, so the search goes on.
    expect(await priceOf(open)).toMatchObject({
      price: nzd(18000),
      basis: 'per_month',
      source: 'org_rule',
      priceRuleId: monthly.id,
    });
    await setDefaultPrice(16000);
    expect(await priceOf(open)).toMatchObject({ price: nzd(16000), source: 'course_default' });
  });

  it('an override replaces the amount and keeps the basis, pack, trial and tax', async () => {
    const s = await setup();
    const { priceOf } = await pricing(s);
    const klass = await s.addClass();
    const gst = await s.addTaxRate('GST', 1500);
    const rule = await s.addRule({
      classId: klass.id,
      basis: 'pack',
      price: nzd(40000),
      packLessons: 10,
      freeTrialLessons: 2,
      taxRateId: gst.id,
    });

    // The override as an enrolment carries it.
    const family = await s.make<Row>('/families', { name: 'Perera', branchId: s.main.id });
    const student = await s.make<Row>('/students', {
      familyId: family.id,
      firstName: 'Aroha',
      lastName: 'Perera',
    });
    const enrolment = await s.make<{ priceOverride: Money }>('/enrolments', {
      studentId: student.id,
      classId: klass.id,
      priceOverride: nzd(35000),
    });

    expect(await priceOf(klass, enrolment.priceOverride)).toEqual({
      price: nzd(35000),
      basis: 'pack',
      packLessons: 10,
      freeTrialLessons: 2,
      taxRateId: gst.id,
      source: 'class_rule',
      priceRuleId: rule.id,
      overridden: true,
    });
  });

  it('charges an override per billing period when nothing else prices the class', async () => {
    const s = await setup();
    const { priceOf } = await pricing(s);
    const gst = await s.addTaxRate('GST', 1500, true);

    expect(await priceOf(await s.addClass(), nzd(30000))).toEqual({
      price: nzd(30000),
      basis: 'per_term',
      packLessons: null,
      freeTrialLessons: 0,
      taxRateId: gst.id,
      source: null,
      priceRuleId: null,
      overridden: true,
    });
    expect(await priceOf(await s.addOpenClass(), nzd(0))).toMatchObject({
      price: nzd(0),
      basis: 'per_month',
      overridden: true,
    });
  });

  it('taxes a price at the rule’s rate, else the org’s default, else not at all', async () => {
    const s = await setup();
    const { priceOf, setDefaultPrice } = await pricing(s);
    const klass = await s.addClass();
    const other = await s.addClass({ name: 'Group B' });
    await setDefaultPrice(45000);
    expect(await priceOf(klass)).toMatchObject({ taxRateId: null });

    const gst = await s.addTaxRate('GST', 1500, true);
    const zero = await s.addTaxRate('Zero-rated', 0);
    expect(await priceOf(klass)).toMatchObject({ source: 'course_default', taxRateId: gst.id });

    // A rule that names a rate keeps it; one that doesn't follows the default.
    const rule = await s.addRule({ ...PER_LESSON, classId: klass.id, taxRateId: zero.id });
    await s.addRule({ ...PER_LESSON, classId: other.id });
    expect(await priceOf(klass)).toMatchObject({ source: 'class_rule', taxRateId: zero.id });
    expect(await priceOf(other)).toMatchObject({ source: 'class_rule', taxRateId: gst.id });

    // The default moves: prices that follow it move with it.
    const moved = await s.api('PATCH', `/tax-rates/${zero.id}`, {
      updatedAt: zero.updatedAt,
      isDefault: true,
    });
    expect(moved.status).toBe(200);
    expect(await priceOf(other)).toMatchObject({ taxRateId: zero.id });
    await s.api('DELETE', `/price-rules/${rule.id}`);
    expect(await priceOf(klass)).toMatchObject({ source: 'course_default', taxRateId: zero.id });
  });
});
