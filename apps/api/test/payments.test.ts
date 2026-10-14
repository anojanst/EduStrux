import { guardians, memberships, paymentAllocations } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency
const TERM_PRICE = 45000;

type Money = { amount: number; currency: string };
type Row = { id: string; updatedAt: string };
type Family = Row & { name: string };
type Invoice = Row & {
  familyId: string;
  status: string;
  total: Money;
  paid: Money;
  balance: Money;
};
type Payment = Row & {
  familyId: string;
  familyName: string;
  branchId: string;
  method: string;
  amount: Money;
  receivedOn: string;
  reference: string | null;
  notes: string | null;
  allocations: { invoiceId: string; amount: Money }[];
};
type As = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => ReturnType<typeof call>;

/**
 * An owner with a fresh org that bills $450 a term: the Main branch, a ten-week term from next
 * Monday and a class in it, with helpers to add families with a child in the class, invoice them
 * and record payments.
 */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body, headers) =>
    call(method, `${base}${path}`, { token: owner.token, body, headers });
  const make = async <T>(path: string, body: unknown, as: As = api) => {
    const res = await as('POST', path, body);
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

  const addClass = async (name = 'Group A', branch: Row = main) => {
    const klass = await make<Row>('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: branch.id,
      name,
    });
    const res = await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 1, startTime: '16:00', endTime: '17:00' }],
    });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
    return klass;
  };
  const klass = await addClass();

  /** A family with one child in the class. */
  const addFamily = async (name = 'Perera', branch: Row = main, classId = klass.id) => {
    const family = await make<Family>('/families', { name, branchId: branch.id });
    const student = await make<Row>('/students', {
      familyId: family.id,
      firstName: 'Aroha',
      lastName: name,
    });
    await make('/enrolments', { studentId: student.id, classId });
    return family;
  };
  /** Another child of the family, in another class: billed by the next run. */
  const addChild = async (familyId: string) => {
    const other = await addClass(`Group ${crypto.randomUUID().slice(0, 4)}`);
    const student = await make<Row>('/students', {
      familyId,
      firstName: 'Kai',
      lastName: 'Second',
    });
    await make('/enrolments', { studentId: student.id, classId: other.id });
  };

  /** Runs the term's invoices and waits for the job. */
  const runTerm = async () => {
    const res = await api('POST', `/terms/${term.id}/generate-invoices`, {});
    if (res.status !== 202) throw new Error(`run failed: ${JSON.stringify(res.body)}`);
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${res.body.jobId}`)).body;
      if (job.status === 'succeeded') return;
      if (job.status === 'failed') throw new Error(`run failed: ${job.error}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('run did not finish');
  };
  const invoicesOf = async (familyId: string) =>
    (await api('GET', `/invoices?familyId=${familyId}`)).body.data as Invoice[];
  const invoice = async (id: string) => (await api('GET', `/invoices/${id}`)).body as Invoice;
  /** Runs the term and issues each family's newest invoice. */
  const issued = async (...families: Family[]) => {
    await runTerm();
    const out: Invoice[] = [];
    for (const family of families) {
      const [newest] = await invoicesOf(family.id);
      const res = await api('POST', `/invoices/${newest!.id}/issue`);
      if (res.status !== 200) throw new Error(`issue failed: ${JSON.stringify(res.body)}`);
      out.push(res.body as Invoice);
    }
    return out;
  };

  /** A payment of `amount` for one invoice, by bank transfer. */
  const paying = (familyId: string, invoiceId: string, amount = TERM_PRICE) => ({
    familyId,
    method: 'bank_transfer',
    amount: nzd(amount),
    allocations: [{ invoiceId, amount: nzd(amount) }],
  });
  const pay = (body: unknown, as: As = api) => make<Payment>('/payments', body, as);
  const payments = async (as: As = api, query = '') =>
    (await as('GET', `/payments${query}`)).body.data as Payment[];

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
  /** A parent who is a guardian of the family. */
  const parentOf = async (familyId: string) => {
    const parent = await member('parent');
    const guardian = await make<Row>(`/families/${familyId}/guardians`, {
      firstName: 'Mere',
      lastName: 'Parent',
    });
    await db()
      .update(guardians)
      .set({ membershipId: parent.id })
      .where(eq(guardians.id, guardian.id));
    return parent;
  };
  const lastAudit = async (limit = 1) =>
    (await api('GET', `/audit-log?limit=${limit}`)).body.data as {
      action: string;
      entityType: string;
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
    term,
    klass,
    addFamily,
    addChild,
    runTerm,
    invoicesOf,
    invoice,
    issued,
    paying,
    pay,
    payments,
    member,
    parentOf,
    lastAudit,
  };
}

describe('recording a payment', () => {
  it('pays an invoice in full, marks it paid, and writes an audit row', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);

    const res = await s.api('POST', '/payments', {
      ...s.paying(perera.id, invoice!.id),
      receivedOn: addDays(today(), -2),
      reference: ' 7K2M9QXA ',
      notes: 'Term 1 fees',
    });

    expect(res.status).toBe(201);
    const payment = res.body as Payment;
    expect(payment).toEqual({
      id: expect.stringMatching(/^pay_/),
      familyId: perera.id,
      familyName: 'Perera',
      branchId: s.main.id,
      method: 'bank_transfer',
      amount: nzd(TERM_PRICE),
      receivedOn: addDays(today(), -2),
      reference: '7K2M9QXA',
      notes: 'Term 1 fees',
      allocations: [{ invoiceId: invoice!.id, amount: nzd(TERM_PRICE) }],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await s.invoice(invoice!.id)).toMatchObject({
      status: 'paid',
      paid: nzd(TERM_PRICE),
      balance: nzd(0),
    });
    // What the write answered with is what a read then finds.
    expect(await s.payments()).toEqual([payment]);

    const [audit] = await s.lastAudit();
    expect(audit).toMatchObject({
      action: 'payment.created',
      entityType: 'payment',
      entityId: payment.id,
      actorUserId: s.owner.userId,
      before: null,
      after: {
        familyId: perera.id,
        method: 'bank_transfer',
        amount: TERM_PRICE,
        currency: 'NZD',
        allocations: [{ invoiceId: invoice!.id, amount: TERM_PRICE }],
      },
    });
  });

  it('pays part of an invoice, then the rest, and can be received today by default', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);

    const first = await s.pay({ ...s.paying(perera.id, invoice!.id, 20000), method: 'cash' });
    expect(first.receivedOn).toBe(today());
    expect(await s.invoice(invoice!.id)).toMatchObject({
      status: 'part_paid',
      paid: nzd(20000),
      balance: nzd(25000),
    });

    await s.pay({ ...s.paying(perera.id, invoice!.id, 25000), method: 'cheque' });
    expect(await s.invoice(invoice!.id)).toMatchObject({
      status: 'paid',
      paid: nzd(TERM_PRICE),
      balance: nzd(0),
    });
  });

  it('pays towards several of the family’s invoices at once', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [older] = await s.issued(perera);
    await s.addChild(perera.id);
    const [newer] = await s.issued(perera);

    const payment = await s.pay({
      familyId: perera.id,
      method: 'card',
      amount: nzd(60000),
      allocations: [
        { invoiceId: older!.id, amount: nzd(TERM_PRICE) },
        { invoiceId: newer!.id, amount: nzd(15000) },
      ],
    });

    expect(payment.allocations).toEqual([
      { invoiceId: older!.id, amount: nzd(TERM_PRICE) },
      { invoiceId: newer!.id, amount: nzd(15000) },
    ]);
    expect(await s.payments()).toEqual([payment]);
    expect((await s.invoicesOf(perera.id)).map((i) => [i.id, i.status, i.balance])).toEqual([
      [newer!.id, 'part_paid', nzd(30000)],
      [older!.id, 'paid', nzd(0)],
    ]);
  });

  it('rejects a bad body with 400', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const ok = s.paying(perera.id, invoice!.id);
    const fieldsOf = async (body: unknown) => {
      const res = await s.api('POST', '/payments', body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      return Object.keys(res.body.error.fields as object);
    };

    expect(await fieldsOf({ ...ok, method: 'bitcoin' })).toEqual(['method']);
    expect(await fieldsOf({ ...ok, amount: nzd(0) })).toContain('amount.amount');
    expect(await fieldsOf({ ...ok, allocations: [] })).toEqual(['allocations']);
    // The allocations add up to the amount: no money is left over.
    expect(
      await fieldsOf({ ...ok, allocations: [{ invoiceId: invoice!.id, amount: nzd(40000) }] }),
    ).toEqual(['allocations']);
    expect(
      await fieldsOf({
        ...ok,
        amount: nzd(TERM_PRICE * 2),
        allocations: [ok.allocations[0], ok.allocations[0]],
      }),
    ).toEqual(['allocations.1.invoiceId']);
    expect(
      await fieldsOf({
        ...ok,
        allocations: [{ invoiceId: invoice!.id, amount: { amount: TERM_PRICE, currency: 'AUD' } }],
      }),
    ).toEqual(['allocations.0.amount.currency']);
    expect(await fieldsOf({ ...ok, reference: 'x'.repeat(101) })).toEqual(['reference']);
    expect(await fieldsOf({ ...ok, receivedOn: '14/10/2026' })).toEqual(['receivedOn']);
    // These need the org: its currency, and its today.
    expect(
      await fieldsOf({
        ...ok,
        amount: { amount: TERM_PRICE, currency: 'AUD' },
        allocations: [{ invoiceId: invoice!.id, amount: { amount: TERM_PRICE, currency: 'AUD' } }],
      }),
    ).toEqual(['amount.currency']);
    expect(await fieldsOf({ ...ok, receivedOn: addDays(today(), 1) })).toEqual(['receivedOn']);

    expect(await s.payments()).toEqual([]);
    expect((await s.invoice(invoice!.id)).status).toBe('issued');
  });

  it('refuses invoices that can’t take it with 422, naming each one', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const silva = await s.addFamily('Silva');
    const [mine, theirs] = await s.issued(perera, silva);
    await s.addChild(perera.id);
    await s.runTerm();
    const [draft] = await s.invoicesOf(perera.id);
    expect(draft!.status).toBe('draft');

    const res = await s.api('POST', '/payments', {
      familyId: perera.id,
      method: 'cash',
      amount: nzd(TERM_PRICE * 2 + 100),
      allocations: [
        { invoiceId: mine!.id, amount: nzd(TERM_PRICE + 100) },
        { invoiceId: theirs!.id, amount: nzd(TERM_PRICE / 2) },
        { invoiceId: draft!.id, amount: nzd(TERM_PRICE / 2) },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'unprocessable',
      fields: {
        'allocations.0.amount': ['More than is owed'],
        'allocations.1.invoiceId': ['Another family’s invoice'],
        'allocations.2.invoiceId': ['Not issued'],
      },
    });

    // A paid invoice and a void one.
    await s.pay(s.paying(perera.id, mine!.id));
    await s.api('POST', `/invoices/${draft!.id}/void`);
    const again = await s.api('POST', '/payments', {
      familyId: perera.id,
      method: 'cash',
      amount: nzd(200),
      allocations: [
        { invoiceId: mine!.id, amount: nzd(100) },
        { invoiceId: draft!.id, amount: nzd(100) },
      ],
    });
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toEqual({
      'allocations.0.invoiceId': ['Already paid'],
      'allocations.1.invoiceId': ['Void'],
    });

    expect(await s.payments()).toHaveLength(1);
    expect((await s.invoice(theirs!.id)).status).toBe('issued');
  });

  it('returns 404 for a family or an invoice the org doesn’t have', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);

    const results = await Promise.all([
      s.api('POST', '/payments', s.paying('fam_missing', invoice!.id)),
      s.api('POST', '/payments', s.paying(perera.id, 'inv_missing')),
    ]);
    expect(results.map((r) => [r.status, r.body.error.message])).toEqual([
      [404, 'Family not found'],
      [404, 'Invoice not found'],
    ]);
  });

  it('lets one of two payments at once take what an invoice still owes', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);

    const results = await Promise.all([
      s.api('POST', '/payments', s.paying(perera.id, invoice!.id)),
      s.api('POST', '/payments', s.paying(perera.id, invoice!.id)),
    ]);

    // The second was read before the first was written (409) or after it (422).
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([409, 422]).toContain(statuses[1]);
    expect(await s.payments()).toHaveLength(1);
    expect(await s.invoice(invoice!.id)).toMatchObject({ status: 'paid', paid: nzd(TERM_PRICE) });
  });

  it('is also held by the database: an allocation past what is owed fails', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const allocation = (amount: number) => ({
      id: newId('paymentAllocation'),
      orgId: s.org.id,
      paymentId: newId('payment'),
      invoiceId: invoice!.id,
      amount,
    });

    await expect(
      db()
        .insert(paymentAllocations)
        .values(allocation(TERM_PRICE + 1)),
    ).rejects.toThrow();
    await db().insert(paymentAllocations).values(allocation(TERM_PRICE));
    await expect(db().insert(paymentAllocations).values(allocation(1))).rejects.toThrow();
  });

  it('replays the first answer for a retry with the same Idempotency-Key', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const key = { 'Idempotency-Key': crypto.randomUUID() };
    const body = s.paying(perera.id, invoice!.id, 10000);

    const first = await s.api('POST', '/payments', body, key);
    const retry = await s.api('POST', '/payments', body, key);

    expect([first.status, retry.status]).toEqual([201, 201]);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await s.payments()).toHaveLength(1);
    expect((await s.invoice(invoice!.id)).paid).toEqual(nzd(10000));
  });
});

describe('an invoice with payments', () => {
  it('can’t be voided until its payments are deleted', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const payment = await s.pay(s.paying(perera.id, invoice!.id, 10000));

    const refused = await s.api('POST', `/invoices/${invoice!.id}/void`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toEqual({ status: ['Has payments'] });

    expect((await s.api('DELETE', `/payments/${payment.id}`)).status).toBe(204);
    const voided = await s.api('POST', `/invoices/${invoice!.id}/void`);
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'void', paid: nzd(0), balance: nzd(0) });
  });
});

describe('deleting a payment', () => {
  it('puts each invoice back as the other payments leave it, with an audit row', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [older] = await s.issued(perera);
    await s.addChild(perera.id);
    const [newer] = await s.issued(perera);
    const kept = await s.pay(s.paying(perera.id, older!.id, 10000));
    const mistake = await s.pay({
      familyId: perera.id,
      method: 'cash',
      amount: nzd(TERM_PRICE),
      allocations: [
        { invoiceId: older!.id, amount: nzd(35000) },
        { invoiceId: newer!.id, amount: nzd(10000) },
      ],
    });
    expect((await s.invoice(older!.id)).status).toBe('paid');

    const res = await s.api('DELETE', `/payments/${mistake.id}`);

    expect(res.status).toBe(204);
    expect(await s.invoice(older!.id)).toMatchObject({
      status: 'part_paid',
      paid: nzd(10000),
      balance: nzd(35000),
    });
    expect(await s.invoice(newer!.id)).toMatchObject({ status: 'issued', paid: nzd(0) });
    expect(await s.payments()).toEqual([kept]);
    expect(await s.payments(s.api, `?invoiceId=${newer!.id}`)).toEqual([]);
    expect((await s.lastAudit())[0]).toMatchObject({
      action: 'payment.deleted',
      entityType: 'payment',
      entityId: mistake.id,
      actorUserId: s.owner.userId,
      before: {
        amount: TERM_PRICE,
        allocations: [
          { invoiceId: older!.id, amount: 35000 },
          { invoiceId: newer!.id, amount: 10000 },
        ],
      },
    });

    // Once gone, it can be paid again, and deleted only once.
    await s.pay(s.paying(perera.id, older!.id, 35000));
    expect((await s.invoice(older!.id)).status).toBe('paid');
    expect((await s.api('DELETE', `/payments/${mistake.id}`)).status).toBe(404);
  });
});

describe('listing payments', () => {
  it('pages newest first, each with its allocations, and filters by family and invoice', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const silva = await s.addFamily('Silva');
    const [pereras, silvas] = await s.issued(perera, silva);
    const first = await s.pay(s.paying(perera.id, pereras!.id, 10000));
    const second = await s.pay(s.paying(silva.id, silvas!.id, 20000));
    const third = await s.pay(s.paying(perera.id, pereras!.id, 30000));

    const page1 = await s.api('GET', '/payments?limit=2');
    expect(page1.body.data).toEqual([third, second]);
    const page2 = await s.api('GET', `/payments?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body).toEqual({ data: [first], nextCursor: null });

    expect(await s.payments(s.api, `?familyId=${perera.id}`)).toEqual([third, first]);
    expect(await s.payments(s.api, `?invoiceId=${silvas!.id}`)).toEqual([second]);
    expect(await s.payments(s.api, `?familyId=${silva.id}&invoiceId=${pereras!.id}`)).toEqual([]);
  });

  it('returns 404 for a filter id the org doesn’t have, and 400 for a bad limit', async () => {
    const s = await setup();
    const results = await Promise.all([
      s.api('GET', '/payments?familyId=fam_missing'),
      s.api('GET', '/payments?invoiceId=inv_missing'),
      s.api('GET', '/payments?limit=0'),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 400]);
  });
});

describe('org isolation', () => {
  it("can't read, pay towards or delete another org's records", async () => {
    const alice = await setup();
    const perera = await alice.addFamily('Perera');
    const [invoice] = await alice.issued(perera);
    const payment = await alice.pay(alice.paying(perera.id, invoice!.id, 10000));
    const bob = await setup();
    const bobs = await bob.addFamily('Bob');
    const asBob = (method: string, path: string, body?: unknown) =>
      call(method, `${alice.base}${path}`, { token: bob.owner.token, body });

    const results = await Promise.all([
      bob.api('GET', `/payments?familyId=${perera.id}`),
      bob.api('GET', `/payments?invoiceId=${invoice!.id}`),
      bob.api('POST', '/payments', bob.paying(perera.id, invoice!.id, 100)),
      bob.api('POST', '/payments', bob.paying(bobs.id, invoice!.id, 100)),
      bob.api('DELETE', `/payments/${payment.id}`),
      asBob('GET', '/payments'),
      asBob('POST', '/payments', alice.paying(perera.id, invoice!.id, 100)),
      asBob('DELETE', `/payments/${payment.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));

    expect(await bob.payments()).toEqual([]);
    expect(await alice.payments()).toEqual([payment]);
    expect((await alice.invoice(invoice!.id)).paid).toEqual(nzd(10000));
  });
});

describe('permissions', () => {
  it.each(['branch_manager', 'front_desk'] as Role[])(
    '%s can record, list and delete payments',
    async (role) => {
      const s = await setup();
      const perera = await s.addFamily('Perera');
      const [invoice] = await s.issued(perera);
      const staff = await s.member(role);

      const payment = await s.pay(s.paying(perera.id, invoice!.id), staff.as);
      expect(await s.payments(staff.as)).toEqual([payment]);
      expect((await staff.as('DELETE', `/payments/${payment.id}`)).status).toBe(204);

      expect((await s.lastAudit(2)).map((e) => [e.action, e.actorUserId])).toEqual([
        ['payment.deleted', staff.userId],
        ['payment.created', staff.userId],
      ]);
    },
  );

  it('accountant can read every payment but not record or delete any', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const payment = await s.pay(s.paying(perera.id, invoice!.id, 10000));
    const accountant = await s.member('accountant');

    expect(await s.payments(accountant.as)).toEqual([payment]);
    const writes = await Promise.all([
      accountant.as('POST', '/payments', s.paying(perera.id, invoice!.id, 100)),
      accountant.as('DELETE', `/payments/${payment.id}`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403]);
    expect(await s.payments()).toEqual([payment]);
  });

  it('teacher has no access to payments at all', async () => {
    const s = await setup();
    const perera = await s.addFamily('Perera');
    const [invoice] = await s.issued(perera);
    const payment = await s.pay(s.paying(perera.id, invoice!.id, 10000));
    const teacher = await s.member('teacher');

    const results = await Promise.all([
      teacher.as('GET', '/payments'),
      teacher.as('POST', '/payments', s.paying(perera.id, invoice!.id, 100)),
      teacher.as('DELETE', `/payments/${payment.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(results[0]!.body.error.code).toBe('forbidden');
  });

  it('parent reads their own family’s payments, and records or deletes none', async () => {
    const s = await setup();
    const mine = await s.addFamily('Mine');
    const theirs = await s.addFamily('Theirs');
    const [own, other] = await s.issued(mine, theirs);
    const ours = await s.pay(s.paying(mine.id, own!.id, 10000));
    await s.pay(s.paying(theirs.id, other!.id, 10000));
    const parent = await s.parentOf(mine.id);

    expect(await s.payments(parent.as)).toEqual([ours]);
    expect(await s.payments(parent.as, `?invoiceId=${own!.id}`)).toEqual([ours]);
    const hidden = await Promise.all([
      parent.as('GET', `/payments?familyId=${theirs.id}`),
      parent.as('GET', `/payments?invoiceId=${other!.id}`),
    ]);
    expect(hidden.map((r) => r.status)).toEqual([404, 404]);

    const writes = await Promise.all([
      parent.as('POST', '/payments', s.paying(mine.id, own!.id, 100)),
      parent.as('DELETE', `/payments/${ours.id}`),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403]);
  });

  it('staff limited to a branch reach only the families whose home branch it is', async () => {
    const s = await setup();
    const albany = await s.make<Row>('/branches', { name: 'Albany' });
    // Both children are in a Main class; only the Silvas' home branch is Albany.
    const perera = await s.addFamily('Perera');
    const silva = await s.addFamily('Silva', albany);
    const [pereras, silvas] = await s.issued(perera, silva);
    const desk = await s.member('front_desk', [albany.id]);
    const others = await s.pay(s.paying(perera.id, pereras!.id, 10000));

    const ours = await s.pay(s.paying(silva.id, silvas!.id, 10000), desk.as);
    expect(ours.branchId).toBe(albany.id);
    expect(await s.payments(desk.as)).toEqual([ours]);

    const hidden = await Promise.all([
      desk.as('GET', `/payments?familyId=${perera.id}`),
      desk.as('GET', `/payments?invoiceId=${pereras!.id}`),
      desk.as('POST', '/payments', s.paying(perera.id, pereras!.id, 100)),
      // Their own family, someone else's invoice: the invoice is out of reach.
      desk.as('POST', '/payments', s.paying(silva.id, pereras!.id, 100)),
      desk.as('DELETE', `/payments/${others.id}`),
    ]);
    expect(hidden.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await s.payments()).toEqual([ours, others]);
  });
});

describe('API docs', () => {
  it('documents the payment routes', async () => {
    const spec = await call('GET', '/api/openapi.json');
    const org = '/api/v1/orgs/{orgId}';
    expect(Object.keys(spec.body.paths[`${org}/payments`])).toEqual(['get', 'post']);
    expect(Object.keys(spec.body.paths[`${org}/payments/{paymentId}`])).toEqual(['delete']);
    expect(spec.body.components.schemas).toHaveProperty('Payment');
    expect(spec.body.components.schemas).toHaveProperty('CreatePayment');
    expect(spec.body.components.schemas.Invoice.properties).toHaveProperty('balance');
  });
});
