import { guardians, memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Every billing endpoint on its heaviest path, held to the budget of D-102: sign-in, one read
// stage and, for a write, one write. `stages` is what a request waited for one after another
// and is the budget. `trips` is every call it made, pinned at what was measured (TUI-97).
// An `Idempotency-Key` adds a call before the handler and one after, counted on their own.

const today = () => localNow('Pacific/Auckland').date; // sampleOrg's timezone
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency

type Row = { id: string; updatedAt: string };
type Res = Awaited<ReturnType<typeof call>>;
type As = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<Res>;

const READ = 2; // sign-in, then one read stage
const WRITE = 3; // sign-in, one read stage, then the write
const KEY = 2; // claiming the Idempotency-Key before the handler, storing the answer after
// `classes.getClass` reads the class and then its weekly slots, so a request that checks a class
// waits one stage more. TUI-96 reads the two together: then this is 0.
const CLASS = 1;

/** What a request may cost: its status, the stages it may wait for, and the trips measured. */
function expectCost(what: string, res: Res, status: number, stages: number, trips: number) {
  expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(status);
  expect(res.db.stages, `${what}: stages`).toBeLessThanOrEqual(stages);
  expect(res.db.trips, `${what}: trips`).toBeLessThanOrEqual(trips);
}

/**
 * Two branches, each with a class in the term and a family with one child in it. The parent is
 * a guardian of the Main family, and the staff member is limited to Albany. A default tax rate,
 * so a price rule can name one.
 */
async function centre() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body, headers) =>
    call(method, `${base}${path}`, { token: owner.token, body, headers });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body, headers) =>
      call(method, `${base}${path}`, { token: user.token, body, headers });
    return { id, as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const albany = await make('/branches', { name: 'Albany' });
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(45000),
  });
  const start = nextMonday();
  const year = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: addDays(start, 69),
  });
  const gst = await make('/tax-rates', {
    name: 'GST',
    rateBps: 1500,
    inclusive: true,
    isDefault: true,
  });

  const parent = await member('parent');
  const staff = await member('branch_manager', [albany.id]);

  /** A class in the term with a lesson every Monday, and a family with one child in it. */
  const group = async (name: string, branch: Row) => {
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: branch.id,
      name,
    });
    const scheduled = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    if (scheduled.status !== 200) throw new Error(`schedule failed for ${name}`);
    const family = await make('/families', { name: `${name} family`, branchId: branch.id });
    const student = await make('/students', {
      familyId: family.id,
      firstName: 'Mia',
      lastName: name,
    });
    await make('/enrolments', { studentId: student.id, classId: klass.id });
    return { branch, klass, family };
  };
  const inMain = await group('Main', main);
  const inAlbany = await group('Albany', albany);

  const guardian = await make(`/families/${inMain.family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Main',
  });
  // What accepting an invite will do: tie the guardian to the parent's membership.
  await db()
    .update(guardians)
    .set({ membershipId: parent.id })
    .where(eq(guardians.id, guardian.id));

  /** Waits for an invoice run, as a client polling its job would. */
  const finished = async (jobId: string) => {
    for (let tries = 0; tries < 400; tries++) {
      const job = (await api('GET', `/jobs/${jobId}`)).body;
      if (job.status === 'succeeded') return;
      if (job.status === 'failed') throw new Error(`invoice run: ${job.error}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`job ${jobId} did not finish`);
  };
  /** Runs the term's invoices: one draft per family. */
  const invoiced = async () => {
    const run = await api('POST', `/terms/${term.id}/generate-invoices`, {});
    await finished(run.body.jobId as string);
    const drafts = (await api('GET', '/invoices?status=draft')).body.data as (Row & {
      familyId: string;
    })[];
    const of = (family: Row) => drafts.find((invoice) => invoice.familyId === family.id)!;
    return { main: of(inMain.family), albany: of(inAlbany.family) };
  };

  return { api, parent, staff, course, term, gst, inMain, inAlbany, finished, invoiced };
}

const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });

describe('invoices (TUI-97)', () => {
  it('reads one invoice, and a page with every filter, as the owner, a parent and staff of one branch', async () => {
    const c = await centre();
    const drafts = await c.invoiced();
    for (const draft of [drafts.main, drafts.albany]) {
      expect((await c.api('POST', `/invoices/${draft.id}/issue`)).status).toBe(200);
    }
    // The heaviest list: every filter that is checked against another module, at once.
    const filtered = (where: typeof c.inMain) =>
      `/invoices?familyId=${where.family.id}&branchId=${where.branch.id}` +
      `&termId=${c.term.id}&status=issued`;
    // Who asks, where their family is, their own invoice and the neighbour's.
    const callers: [string, As, typeof c.inMain, Row, Row][] = [
      ['the owner', c.api, c.inMain, drafts.main, drafts.albany],
      ['a parent', c.parent.as, c.inMain, drafts.main, drafts.albany],
      ['staff of one branch', c.staff.as, c.inAlbany, drafts.albany, drafts.main],
    ];

    for (const [who, as, where, invoice, neighbours] of callers) {
      const one = await as('GET', `/invoices/${invoice.id}`);
      expectCost(`GET /invoices/{id}, ${who}`, one, 200, READ, 6);
      expect(one.body).toMatchObject({ familyId: where.family.id, status: 'issued' });
      expect(one.body.lines).toHaveLength(1);
      expect(one.body.lines[0]).toMatchObject({ studentFirstName: 'Mia', classId: where.klass.id });

      const page = await as('GET', filtered(where));
      expectCost(`GET /invoices with every filter, ${who}`, page, 200, READ, 8);
      expect(page.body.data).toEqual([one.body]);

      const all = await as('GET', '/invoices');
      expectCost(`GET /invoices, ${who}`, all, 200, READ, 5);
      expect(all.body.data).toContainEqual(one.body);

      // An invoice outside the caller's reach costs what one inside it does, so the count of
      // calls doesn't say whether it exists.
      if (as === c.api) continue;
      const hidden = await as('GET', `/invoices/${neighbours.id}`);
      expect(hidden.status, `the neighbour's invoice, ${who}`).toBe(404);
      expect(hidden.db, `the neighbour's invoice, ${who}`).toEqual(one.db);
    }
  });

  it('changes, issues and voids an invoice in one read stage and one write', async () => {
    const c = await centre();
    const drafts = await c.invoiced();
    const due = addDays(today(), 30);

    const issued = await c.api('POST', `/invoices/${drafts.main.id}/issue`);
    expectCost('POST /invoices/{id}/issue', issued, 200, WRITE, 7);
    expect(issued.body).toMatchObject({ status: 'issued', issuedAt: expect.any(String) });
    expect(issued.body.lines).toHaveLength(1);

    const withKey = await c.staff.as(
      'POST',
      `/invoices/${drafts.albany.id}/issue`,
      undefined,
      key(),
    );
    expectCost('POST /invoices/{id}/issue with a key, staff', withKey, 200, WRITE + KEY, 7 + KEY);
    expect(withKey.body.status).toBe('issued');

    const changed = await c.api('PATCH', `/invoices/${drafts.main.id}`, {
      updatedAt: issued.body.updatedAt,
      dueDate: due,
      notes: 'Pay by transfer',
    });
    expectCost('PATCH /invoices/{id}', changed, 200, WRITE, 7);
    expect(changed.body).toEqual({
      ...issued.body,
      dueDate: due,
      notes: 'Pay by transfer',
      updatedAt: expect.any(String),
    });
    // What the write answered with is what a read then finds.
    expect((await c.api('GET', `/invoices/${drafts.main.id}`)).body).toEqual(changed.body);

    const byStaff = await c.staff.as('PATCH', `/invoices/${drafts.albany.id}`, {
      updatedAt: withKey.body.updatedAt,
      dueDate: due,
    });
    expectCost('PATCH /invoices/{id}, staff of one branch', byStaff, 200, WRITE, 7);

    const voided = await c.api('POST', `/invoices/${drafts.main.id}/void`);
    expectCost('POST /invoices/{id}/void', voided, 200, WRITE, 7);
    expect(voided.body).toEqual({
      ...changed.body,
      status: 'void',
      voidedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await c.api('GET', `/invoices/${drafts.main.id}`)).body).toEqual(voided.body);

    const voidedWithKey = await c.staff.as(
      'POST',
      `/invoices/${drafts.albany.id}/void`,
      undefined,
      key(),
    );
    expectCost(
      'POST /invoices/{id}/void with a key, staff',
      voidedWithKey,
      200,
      WRITE + KEY,
      7 + KEY,
    );
  });

  it('starts a run in at most one read and one write', async () => {
    const c = await centre();

    // The term is read to check it exists, then the job is written.
    const termRun = await c.staff.as('POST', `/terms/${c.term.id}/generate-invoices`, {});
    expectCost('POST /terms/{id}/generate-invoices, staff', termRun, 202, WRITE, 3);
    await c.finished(termRun.body.jobId as string);

    const withKey = await c.api('POST', `/terms/${c.term.id}/generate-invoices`, {}, key());
    expectCost('POST /terms/{id}/generate-invoices with a key', withKey, 202, WRITE + KEY, 3 + KEY);
    await c.finished(withKey.body.jobId as string);

    // A month needs no read: sign-in, then the job.
    const month = nextMonday().slice(0, 7);
    const monthRun = await c.api('POST', '/invoices/generate-monthly', { month });
    expectCost('POST /invoices/generate-monthly', monthRun, 202, 2, 2);
    await c.finished(monthRun.body.jobId as string);
  });
});

describe('price rules (TUI-97)', () => {
  it('lists, adds, changes and deletes a price rule within the budget', async () => {
    const c = await centre();
    const classRule = (where: typeof c.inMain) => ({
      classId: where.klass.id,
      basis: 'per_term',
      price: nzd(52000),
      taxRateId: c.gst.id,
    });

    // The heaviest: the class, the tax rate and whether the class has a rule, read together.
    const added = await c.api('POST', '/price-rules', classRule(c.inMain));
    expectCost('POST /price-rules, a class with a tax rate', added, 201, WRITE + CLASS, 6);
    expect(added.body).toMatchObject({ ...classRule(c.inMain), courseId: null });
    const byStaff = await c.staff.as('POST', '/price-rules', classRule(c.inAlbany));
    expectCost('POST /price-rules, staff of one branch', byStaff, 201, WRITE + CLASS, 6);
    // What the write answered with is what a read then finds.
    expect((await c.api('GET', `/price-rules?classId=${c.inMain.klass.id}`)).body.data).toEqual([
      added.body,
    ]);

    const courseRule = await c.api('POST', '/price-rules', {
      courseId: c.course.id,
      basis: 'per_lesson',
      price: nzd(4000),
    });
    expectCost('POST /price-rules, a course', courseRule, 201, WRITE, 4);

    const list = await c.api('GET', '/price-rules');
    expectCost('GET /price-rules', list, 200, READ, 2);
    expect(list.body.data).toHaveLength(3);
    const ofClass = await c.staff.as(
      'GET',
      `/price-rules?classId=${c.inAlbany.klass.id}&courseId=${c.course.id}`,
    );
    expectCost('GET /price-rules?classId&courseId, staff', ofClass, 200, READ + CLASS, 5);
    expect(ofClass.body.data).toEqual([]); // no rule is for a class and a course at once

    const changed = await c.api('PATCH', `/price-rules/${added.body.id}`, {
      updatedAt: added.body.updatedAt,
      price: nzd(50000),
      taxRateId: c.gst.id,
      freeTrialLessons: 1,
    });
    expectCost('PATCH /price-rules/{id}', changed, 200, WRITE, 4);
    expect(changed.body).toEqual({
      ...added.body,
      price: nzd(50000),
      freeTrialLessons: 1,
      updatedAt: expect.any(String),
    });
    expect((await c.api('GET', `/price-rules?classId=${c.inMain.klass.id}`)).body.data).toEqual([
      changed.body,
    ]);

    const deleted = await c.staff.as('DELETE', `/price-rules/${byStaff.body.id}`);
    expectCost('DELETE /price-rules/{id}, staff', deleted, 204, WRITE, 3);
  });
});

describe('tax rates (TUI-97)', () => {
  it('lists, adds, changes and deletes a tax rate within the budget', async () => {
    const c = await centre();

    const added = await c.api('POST', '/tax-rates', {
      name: 'VAT',
      rateBps: 2000,
      inclusive: false,
      isDefault: true, // takes the default from GST, in the same write
    });
    expectCost('POST /tax-rates', added, 201, WRITE, 3);
    expect(added.body).toMatchObject({ name: 'VAT', rateBps: 2000, isDefault: true });

    const list = await c.api('GET', '/tax-rates');
    expectCost('GET /tax-rates', list, 200, READ, 2);
    const gst = { ...c.gst, isDefault: false, updatedAt: expect.any(String) };
    expect(list.body.data).toEqual([gst, added.body]);

    // The heaviest: a new name, checked beside the read of the rate, and the default taken back.
    const changed = await c.api('PATCH', `/tax-rates/${c.gst.id}`, {
      updatedAt: (list.body.data[0] as Row).updatedAt,
      name: 'GST 15%',
      isDefault: true,
    });
    expectCost('PATCH /tax-rates/{id}', changed, 200, WRITE, 4);
    expect(changed.body).toEqual({ ...gst, name: 'GST 15%', isDefault: true });
    // What the write answered with is what a read then finds.
    expect((await c.api('GET', '/tax-rates')).body.data).toEqual([
      changed.body,
      { ...added.body, isDefault: false, updatedAt: expect.any(String) },
    ]);

    const deleted = await c.api('DELETE', `/tax-rates/${added.body.id}`);
    expectCost('DELETE /tax-rates/{id}', deleted, 204, WRITE, 4);
  });
});
