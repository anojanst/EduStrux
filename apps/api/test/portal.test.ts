import { guardians, memberships, sessions } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// The parent portal (TUI-39, D-126): a signed-in parent's view of their own children, their
// timetable and their invoices. Every other role is refused.

const TZ = 'Pacific/Auckland'; // sampleOrg's timezone
const today = () => localNow(TZ).date;
/** The Monday after today, so every lesson of that week is still to come. */
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' }); // sampleOrg's currency
const TERM_PRICE = 45000;
const READ = 2; // sign-in, then one read stage (D-102)

type Row = { id: string; updatedAt: string };
type Session = Row & {
  classId: string;
  date: string;
  status: string;
  children: { id: string; firstName: string; lastName: string }[];
};
type Invoice = Row & {
  familyId: string;
  status: string;
  total: { amount: number; currency: string };
  lines: Record<string, unknown>[];
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

/**
 * An org with a ten-week term from next Monday and two classes in it: Maths on Mondays and
 * English on Wednesdays. The Perera family has a parent who signs in and two children: Kai in
 * Maths for the whole term, and Aroha in Maths from the third week and in English at her own
 * price. The Silva family has a child in English, and isn't the parent's.
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
  /** A member of the org with the given role, added straight to the database (TUI-42). */
  const member = async (role: Role) => {
    const user = await newUser(role);
    const id = newId('membership');
    await db()
      .insert(memberships)
      .values({ id, orgId: org.id, userId: user.userId, role, branchIds: null });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { id, as };
  };
  /** Links a guardian to a parent's membership, as accepting an invite will (D-123). */
  const link = async (guardianId: string, membershipId: string) => {
    await db().update(guardians).set({ membershipId }).where(eq(guardians.id, guardianId));
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(TERM_PRICE),
  });
  const start = nextMonday();
  const end = addDays(start, 69);
  const year = await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today(), -60),
    endDate: addDays(start, 300),
  });
  const term = await make('/terms', {
    academicYearId: year.id,
    name: 'Term 1',
    startDate: start,
    endDate: end,
  });
  const addClass = async (name: string, weekdayNo: number) => {
    const klass = await make('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name,
    });
    const slots = [{ weekday: weekdayNo, startTime: '16:00', endTime: '17:00' }];
    const res = await api('PUT', `/classes/${klass.id}/schedule`, { slots });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
    return klass;
  };
  const maths = await addClass('Maths', 1);
  const english = await addClass('English', 3);

  const perera = await make<Row & { name: string }>('/families', {
    name: 'Perera',
    branchId: main.id,
  });
  const silva = await make<Row & { name: string }>('/families', {
    name: 'Silva',
    branchId: main.id,
  });
  const guardian = await make(`/families/${perera.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
  });
  const parent = await member('parent');
  await link(guardian.id, parent.id);

  const child = (familyId: string, firstName: string, lastName: string) =>
    make('/students', {
      familyId,
      firstName,
      lastName,
      gradeLevelId: grade.id,
      notes: 'Staff only: ask about the overdue fees',
    });
  const kai = await child(perera.id, 'Kai', 'Perera');
  const aroha = await child(perera.id, 'Aroha', 'Perera');
  const tama = await child(silva.id, 'Tama', 'Silva');
  const enrol = (studentId: string, classId: string, body: Record<string, unknown> = {}) =>
    make('/enrolments', { studentId, classId, ...body });
  const kaiMaths = await enrol(kai.id, maths.id);
  const arohaMaths = await enrol(aroha.id, maths.id, { startDate: addDays(start, 14) });
  const arohaEnglish = await enrol(aroha.id, english.id, { priceOverride: nzd(30000) });
  await enrol(tama.id, english.id);

  /** Runs the term's invoices and waits for the job, as a client would. */
  const runTerm = async () => {
    const res = await api('POST', `/terms/${term.id}/generate-invoices`, {});
    if (res.status !== 202) throw new Error(`run failed: ${JSON.stringify(res.body)}`);
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${res.body.jobId}`)).body;
      if (job.status === 'succeeded') return job;
      if (job.status === 'failed') throw new Error(`run failed: ${job.error}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('run did not finish');
  };
  const invoiceOf = async (familyId: string) =>
    (await api('GET', `/invoices?familyId=${familyId}`)).body.data[0] as Invoice;

  return {
    org,
    base,
    owner,
    api,
    make,
    member,
    link,
    main,
    grade,
    start,
    end,
    maths,
    english,
    perera,
    silva,
    parent,
    kai,
    aroha,
    tama,
    kaiMaths,
    arohaMaths,
    arohaEnglish,
    runTerm,
    invoiceOf,
  };
}

describe('GET /portal/children', () => {
  it('lists the parent’s children with their family and active enrolments, without staff notes', async () => {
    const s = await setup();

    const res = await s.parent.as('GET', '/portal/children');

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const enrolment = (id: string, className: string, priceOverride: unknown) =>
      expect.objectContaining({ id, className, branchId: s.main.id, priceOverride });
    // In name order: Aroha, then Kai. Tama is the Silvas', not the parent's.
    expect(res.body.data).toEqual([
      {
        id: s.aroha.id,
        familyId: s.perera.id,
        familyName: 'Perera',
        branchId: s.main.id,
        firstName: 'Aroha',
        lastName: 'Perera',
        dateOfBirth: null,
        gradeLevelId: s.grade.id,
        enrolments: [
          enrolment(s.arohaMaths.id, 'Maths', null),
          enrolment(s.arohaEnglish.id, 'English', nzd(30000)),
        ],
      },
      {
        id: s.kai.id,
        familyId: s.perera.id,
        familyName: 'Perera',
        branchId: s.main.id,
        firstName: 'Kai',
        lastName: 'Perera',
        dateOfBirth: null,
        gradeLevelId: s.grade.id,
        enrolments: [enrolment(s.kaiMaths.id, 'Maths', null)],
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Staff only');
    expect(res.db.stages).toBeLessThanOrEqual(READ);
  });

  it('covers every family the parent is a guardian of, and none they aren’t', async () => {
    const s = await setup();
    const silvaGuardian = await s.make(`/families/${s.silva.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Silva',
    });

    expect((await s.parent.as('GET', '/portal/children')).body.data).toHaveLength(2);
    await s.link(silvaGuardian.id, s.parent.id);
    const children = (await s.parent.as('GET', '/portal/children')).body.data;
    expect(children.map((c: { firstName: string }) => c.firstName)).toEqual([
      'Aroha',
      'Kai',
      'Tama',
    ]);
    expect(children[2]).toMatchObject({ familyId: s.silva.id, familyName: 'Silva' });

    // A parent linked to no guardian has no children here.
    const stranger = await s.member('parent');
    expect((await stranger.as('GET', '/portal/children')).body).toEqual({
      data: [],
      nextCursor: null,
    });
  });
});

describe('GET /portal/sessions', () => {
  it('lists the children’s sessions on the dates their enrolments cover, naming who each is for', async () => {
    const s = await setup();
    const week3 = addDays(s.start, 14);

    const res = await s.parent.as(
      'GET',
      `/portal/sessions?from=${s.start}&to=${addDays(week3, 6)}`,
    );

    expect(res.status).toBe(200);
    const rows = (res.body.data as Session[]).map((session) => [
      session.date,
      session.classId,
      session.children.map((c) => c.firstName),
    ]);
    // Maths on Mondays has Kai from the start and Aroha from week 3. English on Wednesdays has
    // Aroha all term. Tama is in English too, but he isn't named.
    expect(rows).toEqual([
      [s.start, s.maths.id, ['Kai']],
      [addDays(s.start, 2), s.english.id, ['Aroha']],
      [addDays(s.start, 7), s.maths.id, ['Kai']],
      [addDays(s.start, 9), s.english.id, ['Aroha']],
      [week3, s.maths.id, ['Aroha', 'Kai']],
      [addDays(week3, 2), s.english.id, ['Aroha']],
    ]);
    expect(res.body.data[0]).toMatchObject({
      className: 'Maths',
      startTime: '16:00',
      endTime: '17:00',
      status: 'scheduled',
      startsAt: expect.any(String),
    });
    expect(res.body.nextCursor).toBeNull();
    expect(res.db.stages).toBeLessThanOrEqual(READ);
  });

  it('leaves out the lessons before a child’s enrolment starts and the classes none of them is in', async () => {
    const s = await setup();
    // The Ngatas' only child, Mia, joins Maths in week 3. They have nobody in English.
    const ngata = await s.make('/families', { name: 'Ngata', branchId: s.main.id });
    const mia = await s.make('/students', {
      familyId: ngata.id,
      firstName: 'Mia',
      lastName: 'Ngata',
    });
    const week3 = addDays(s.start, 14);
    await s.make('/enrolments', { studentId: mia.id, classId: s.maths.id, startDate: week3 });
    const guardian = await s.make(`/families/${ngata.id}/guardians`, {
      firstName: 'Hemi',
      lastName: 'Ngata',
    });
    const parent = await s.member('parent');
    await s.link(guardian.id, parent.id);
    const range = `from=${s.start}&to=${s.end}&limit=200`;

    const portal = (await parent.as('GET', `/portal/sessions?${range}`)).body.data as Session[];

    expect(portal.map((session) => session.date)).toEqual(
      Array.from({ length: 8 }, (_, week) => addDays(week3, 7 * week)),
    );
    expect(portal.every((session) => session.classId === s.maths.id)).toBe(true);
    expect(portal.map((session) => session.children)).toEqual(
      portal.map(() => [{ id: mia.id, firstName: 'Mia', lastName: 'Ngata' }]),
    );
    // GET /sessions gives a parent all of Maths, from its first lesson (D-060).
    const all = (await parent.as('GET', `/sessions?${range}`)).body.data as Session[];
    expect(all).toHaveLength(10);
  });

  it('gives one child’s timetable with studentId, and keeps cancelled sessions', async () => {
    const s = await setup();
    const range = `from=${s.start}&to=${addDays(s.start, 13)}`;
    const first = (await s.parent.as('GET', `/portal/sessions?${range}&studentId=${s.aroha.id}`))
      .body.data as Session[];
    expect(first.map((session) => session.classId)).toEqual([s.english.id, s.english.id]);

    await db().update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, first[0]!.id));
    const after = (await s.parent.as('GET', `/portal/sessions?${range}&studentId=${s.aroha.id}`))
      .body.data as Session[];
    expect(after.map((session) => session.status)).toEqual(['cancelled', 'scheduled']);
  });

  it('pages in date then start-time order', async () => {
    const s = await setup();
    const path = `/portal/sessions?from=${s.start}&to=${s.end}&limit=3`;
    const one = await s.parent.as('GET', path);
    const two = await s.parent.as('GET', `${path}&cursor=${one.body.nextCursor}`);

    expect(one.body.data).toHaveLength(3);
    expect(one.body.nextCursor).toEqual(expect.any(String));
    const dates = [...one.body.data, ...two.body.data].map((session: Session) => session.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('rejects a missing or backwards date range with 400', async () => {
    const s = await setup();
    const results = await Promise.all([
      s.parent.as('GET', '/portal/sessions'),
      s.parent.as('GET', `/portal/sessions?from=${s.end}&to=${s.start}`),
      s.parent.as('GET', `/portal/sessions?from=next-week&to=${s.end}`),
      s.parent.as('GET', `/portal/sessions?from=${s.start}&to=${s.end}&limit=0`),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(results[1]!.body.error).toMatchObject({
      code: 'validation_failed',
      fields: { to: expect.any(Array) },
    });
  });

  it('is 404 for a studentId that isn’t one of the parent’s children', async () => {
    const s = await setup();
    const res = await s.parent.as(
      'GET',
      `/portal/sessions?from=${s.start}&to=${s.end}&studentId=${s.tama.id}`,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /portal/invoices', () => {
  it('lists the family’s issued invoices with paid and balance, and lines without the price rule', async () => {
    const s = await setup();
    await s.runTerm();
    const own = await s.invoiceOf(s.perera.id);
    const other = await s.invoiceOf(s.silva.id);
    await s.api('POST', `/invoices/${other.id}/issue`);

    // A draft isn't the parent's to see yet.
    expect((await s.parent.as('GET', '/portal/invoices')).body.data).toEqual([]);

    const issued = (await s.api('POST', `/invoices/${own.id}/issue`)).body as Invoice;
    await s.make('/payments', {
      familyId: s.perera.id,
      method: 'cash',
      amount: nzd(10000),
      allocations: [{ invoiceId: own.id, amount: nzd(10000) }],
    });
    const staffView = (await s.api('GET', `/invoices/${own.id}`)).body as Invoice;
    const res = await s.parent.as('GET', '/portal/invoices');

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.data).toEqual([
      {
        ...staffView,
        lines: staffView.lines.map(({ priceSource: _s, priceRuleId: _r, ...line }) => line),
      },
    ]);
    expect(res.body.data[0]).toMatchObject({
      id: issued.id,
      status: 'part_paid',
      paid: nzd(10000),
      balance: { amount: issued.total.amount - 10000, currency: 'NZD' },
    });
    expect(res.body.data[0].lines).toHaveLength(3);
    for (const line of res.body.data[0].lines) {
      expect(line).not.toHaveProperty('priceSource');
      expect(line).not.toHaveProperty('priceRuleId');
    }
    expect(res.db.stages).toBeLessThanOrEqual(READ);
  });

  it('filters by family and status, keeps a voided invoice as void, and is 404 for another family', async () => {
    const s = await setup();
    await s.runTerm();
    const own = await s.invoiceOf(s.perera.id);
    await s.api('POST', `/invoices/${own.id}/issue`);

    const mine = await s.parent.as('GET', `/portal/invoices?familyId=${s.perera.id}&status=issued`);
    expect(mine.body.data.map((i: Invoice) => i.id)).toEqual([own.id]);
    const paid = await s.parent.as('GET', '/portal/invoices?status=paid');
    expect(paid.body.data).toEqual([]);

    await s.api('POST', `/invoices/${own.id}/void`);
    const after = await s.parent.as('GET', '/portal/invoices');
    expect(after.body.data.map((i: Invoice) => i.status)).toEqual(['void']);
    expect(after.body.data[0].balance).toEqual(nzd(0));

    const theirs = await s.parent.as('GET', `/portal/invoices?familyId=${s.silva.id}`);
    expect(theirs.status).toBe(404);
  });

  it('rejects a bad query with 400', async () => {
    const s = await setup();
    const results = await Promise.all([
      s.parent.as('GET', '/portal/invoices?status=overdue'),
      s.parent.as('GET', '/portal/invoices?limit=500'),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400]);
    expect(results[0]!.body.error).toMatchObject({
      code: 'validation_failed',
      fields: { status: expect.any(Array) },
    });
  });
});

describe('permissions', () => {
  const routes = (s: Awaited<ReturnType<typeof setup>>) => [
    '/portal/children',
    `/portal/sessions?from=${s.start}&to=${s.end}`,
    '/portal/invoices',
  ];

  it('refuses every role but parent with 403, the owner included', async () => {
    const s = await setup();
    const staff = await Promise.all(
      (['branch_manager', 'front_desk', 'teacher', 'accountant'] as Role[]).map(s.member),
    );
    const results = await Promise.all(
      [s.api, ...staff.map((m) => m.as)].flatMap((as) => routes(s).map((path) => as('GET', path))),
    );
    expect(results.map((r) => r.status)).toEqual(results.map(() => 403));
    expect(results[0]!.body.error.code).toBe('forbidden');
  });

  it('only reads: a parent’s visits leave no audit rows', async () => {
    const s = await setup();
    const before = (await s.api('GET', '/audit-log?limit=200')).body.data.length;
    for (const path of routes(s)) expect((await s.parent.as('GET', path)).status).toBe(200);
    expect((await s.api('GET', '/audit-log?limit=200')).body.data.length).toBe(before);
  });
});

describe('org isolation', () => {
  it('is 404 for another org, and for another org’s children and families', async () => {
    const alice = await setup();
    const bob = await setup();
    const range = (org: { start: string; end: string }) => `from=${org.start}&to=${org.end}`;
    const intoAlice = (path: string) =>
      call('GET', `${alice.base}${path}`, { token: bob.owner.token });

    const results = await Promise.all([
      // Bob is no member of Alice's org: every portal route there is 404.
      intoAlice('/portal/children'),
      intoAlice(`/portal/sessions?${range(alice)}`),
      intoAlice('/portal/invoices'),
      // In Bob's own org, Alice's ids are no child or family of his parent's.
      bob.parent.as('GET', `/portal/sessions?${range(bob)}&studentId=${alice.aroha.id}`),
      bob.parent.as('GET', `/portal/invoices?familyId=${alice.perera.id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));

    // Each parent sees only their own org's children.
    const bobsChildren = (await bob.parent.as('GET', '/portal/children')).body.data;
    expect(bobsChildren.map((c: { id: string }) => c.id)).toEqual([bob.aroha.id, bob.kai.id]);
  });
});
