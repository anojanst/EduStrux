import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, weekday, type Role } from '@edustrux/shared';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// Changing, withdrawing and transferring an enrolment (TUI-46), and what that does to its
// invoices: pro rata by lessons (D-086), at the price the line was charged at (D-093).

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
const nextMonday = () => addDays(today(), 8 - weekday(today()));
const nzd = (amount: number) => ({ amount, currency: 'NZD' });

type Row = { id: string; updatedAt: string };
type Enrolment = Row & {
  studentId: string;
  classId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  priceOverride?: { amount: number; currency: string } | null;
};
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

const MON = { weekday: 1, startTime: '16:00', endTime: '17:00' };

/**
 * An org with a ten-week term from next Monday and two classes in it, A and B, each with a
 * lesson every Monday (ten lessons) and charged $450 a term. Aroha is enrolled in A.
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
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };

  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', {
    subjectId: subject.id,
    gradeLevelId: grade.id,
    defaultPrice: nzd(45000),
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
  const addClass = async (name: string, body: Record<string, unknown> = {}) => {
    const klass = await make<Row & { name: string }>('/classes', {
      courseId: course.id,
      termId: term.id,
      branchId: main.id,
      name,
      ...body,
    });
    const res = await api('PUT', `/classes/${klass.id}/schedule`, { slots: [MON] });
    if (res.status !== 200) throw new Error(`schedule failed: ${JSON.stringify(res.body)}`);
    return klass;
  };
  const classA = await addClass('Group A');
  const classB = await addClass('Group B');
  const family = await make('/families', { name: 'Perera', branchId: main.id });
  const aroha = await make('/students', {
    familyId: family.id,
    firstName: 'Aroha',
    lastName: 'Perera',
  });
  const enrolment = await make<Enrolment>('/enrolments', {
    studentId: aroha.id,
    classId: classA.id,
  });

  const finished = async (jobId: string) => {
    for (let i = 0; i < 400; i++) {
      const job = (await api('GET', `/jobs/${jobId}`)).body;
      if (job.status === 'succeeded' || job.status === 'failed') return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`job ${jobId} did not finish`);
  };
  const runTerm = async () => {
    const res = await api('POST', `/terms/${term.id}/generate-invoices`, {});
    if (res.status !== 202) throw new Error(`run failed: ${JSON.stringify(res.body)}`);
    return finished(res.body.jobId);
  };
  const invoices = async () =>
    (await api('GET', `/invoices?familyId=${family.id}`)).body.data as (Row & {
      status: string;
      total: { amount: number };
      lines: { enrolmentId: string; lessons: number; total: { amount: number } }[];
    })[];
  const patch = (body: Record<string, unknown>, as: As = api, id = enrolment.id) =>
    as('PATCH', `/enrolments/${id}`, body);
  const lastAudit = async () =>
    (await api('GET', '/audit-log?limit=1')).body.data[0] as {
      action: string;
      entityId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

  return {
    org,
    base,
    api,
    make,
    member,
    main,
    course,
    term,
    start,
    end,
    classA,
    classB,
    addClass,
    family,
    aroha,
    enrolment,
    runTerm,
    invoices,
    patch,
    lastAudit,
  };
}

/** The Monday `weeks` after `start`. */
const monday = (start: string, weeks: number) => addDays(start, 7 * weeks);

describe('PATCH /enrolments/{id}: changes', () => {
  it('changes the dates and the price override, with an audit row of what changed', async () => {
    const { patch, enrolment, start, end, lastAudit } = await setup();
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      startDate: monday(start, 1),
      endDate: monday(start, 5),
      priceOverride: nzd(30000),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enrolment: expect.objectContaining({
        id: enrolment.id,
        startDate: monday(start, 1),
        endDate: monday(start, 5),
        priceOverride: nzd(30000),
        status: 'active',
        studentFirstName: 'Aroha',
        className: 'Group A',
      }),
      transferredTo: null,
      invoices: [],
    });
    expect(await lastAudit()).toMatchObject({
      action: 'enrolment.updated',
      entityId: enrolment.id,
      before: { startDate: enrolment.startDate, endDate: null, priceOverrideAmount: null },
      after: { startDate: monday(start, 1), endDate: monday(start, 5), priceOverrideAmount: 30000 },
    });

    // Nothing but updatedAt changes nothing.
    const same = await patch({ updatedAt: res.body.enrolment.updatedAt });
    expect(same.status).toBe(200);
    expect(same.body.enrolment).toEqual(res.body.enrolment);

    const stale = await patch({ updatedAt: enrolment.updatedAt, endDate: null });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_data');

    const outside = await patch({
      updatedAt: res.body.enrolment.updatedAt,
      endDate: addDays(end, 1),
    });
    expect(outside.status).toBe(422);
    expect(outside.body.error.fields).toEqual({ endDate: ['Outside the class dates'] });
  });

  it('refuses bad input with 400', async () => {
    const { patch, enrolment, start, classB } = await setup();
    const backwards = await patch({
      updatedAt: enrolment.updatedAt,
      startDate: monday(start, 3),
      endDate: monday(start, 2),
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.fields).toHaveProperty('endDate');
    const currency = await patch({
      updatedAt: enrolment.updatedAt,
      priceOverride: { amount: 100, currency: 'AUD' },
    });
    expect(currency.status).toBe(400);
    expect(currency.body.error.fields).toHaveProperty(['priceOverride.currency']);
    const mixed = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      transfer: { classId: classB.id },
    });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error.fields).toHaveProperty('transfer');
    expect((await patch({ updatedAt: enrolment.updatedAt, status: 'active' })).status).toBe(400);
    expect((await patch({ endDate: null })).status).toBe(400);
  });
});

describe('withdrawing', () => {
  it('ends the enrolment, frees the place and keeps it billable up to the last day', async () => {
    const { patch, enrolment, start, lastAudit, make, classA, family, runTerm, invoices, api } =
      await setup();
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      endDate: monday(start, 3),
    });
    expect(res.status).toBe(200);
    expect(res.body.enrolment).toMatchObject({ status: 'withdrawn', endDate: monday(start, 3) });
    expect((await lastAudit()).action).toBe('enrolment.withdrawn');

    // A withdrawn enrolment can't be changed again.
    const again = await patch({ updatedAt: res.body.enrolment.updatedAt, endDate: null });
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toEqual({ status: ['Withdrawn'] });

    // The student can be enrolled in the class again.
    const sibling = await make('/students', {
      familyId: family.id,
      firstName: 'Sam',
      lastName: 'Perera',
    });
    expect(
      (await api('POST', '/enrolments', { studentId: sibling.id, classId: classA.id })).status,
    ).toBe(201);

    // A run bills the four lessons before Aroha left: 4 of 10 at $450 is $180.
    await runTerm();
    const [invoice] = await invoices();
    const line = invoice!.lines.find((l) => l.enrolmentId === enrolment.id)!;
    expect(line).toMatchObject({ lessons: 4, total: { amount: 18000 } });
  });

  it('withdraws today, or the day before a start still to come, when no date is sent', async () => {
    const { patch, enrolment, start } = await setup();
    const early = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      endDate: addDays(enrolment.startDate, -2),
    });
    expect(early.status).toBe(400);
    expect(early.body.error.fields).toEqual({ endDate: ['Before startDate'] });

    // The enrolment starts next Monday, so withdrawing now means it never started: it ends the
    // day before.
    expect(enrolment.startDate).toBe(start);
    const res = await patch({ updatedAt: enrolment.updatedAt, status: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(res.body.enrolment.endDate).toBe(addDays(start, -1));
  });

  it('charges a draft invoice’s line again, pro rata, and voids a draft left empty', async () => {
    const { patch, enrolment, start, runTerm, invoices, lastAudit } = await setup();
    await runTerm();
    const [draft] = await invoices();
    expect(draft).toMatchObject({ status: 'draft', total: { amount: 45000 } });

    const res = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      endDate: monday(start, 5),
    });
    expect(res.status).toBe(200);
    expect(res.body.invoices).toEqual([
      {
        invoiceId: draft!.id,
        invoiceLineId: expect.any(String),
        invoiceStatus: 'draft',
        adjusted: true,
        lessonsBefore: 10,
        lessonsAfter: 6,
        before: nzd(45000),
        after: nzd(27000),
      },
    ]);
    const [after] = await invoices();
    expect(after).toMatchObject({ status: 'draft', total: { amount: 27000 } });
    expect(after!.lines[0]).toMatchObject({ lessons: 6, total: { amount: 27000 } });
    expect((await lastAudit()).after).toMatchObject({
      status: 'withdrawn',
      invoices: res.body.invoices,
    });
  });

  it('takes the line off a draft when no lesson is left, voiding the empty draft', async () => {
    const { patch, enrolment, runTerm, invoices } = await setup();
    await runTerm();
    const [draft] = await invoices();
    const res = await patch({ updatedAt: enrolment.updatedAt, status: 'withdrawn' });
    expect(res.body.invoices).toEqual([
      expect.objectContaining({
        invoiceId: draft!.id,
        invoiceStatus: 'void',
        adjusted: true,
        lessonsAfter: 0,
        after: nzd(0),
      }),
    ]);
    const [voided] = await invoices();
    expect(voided).toMatchObject({ status: 'void', total: { amount: 0 }, lines: [] });
  });

  it('reports an issued invoice’s line with what it would charge, and leaves it as it is', async () => {
    const { patch, api, enrolment, start, runTerm, invoices } = await setup();
    await runTerm();
    const [draft] = await invoices();
    expect((await api('POST', `/invoices/${draft!.id}/issue`)).status).toBe(200);
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      endDate: monday(start, 1),
    });
    expect(res.body.invoices).toEqual([
      expect.objectContaining({
        invoiceStatus: 'issued',
        adjusted: false,
        lessonsBefore: 10,
        lessonsAfter: 2,
        before: nzd(45000),
        after: nzd(9000),
      }),
    ]);
    const [issued] = await invoices();
    expect(issued).toMatchObject({ status: 'issued', total: { amount: 45000 } });
  });
});

describe('transferring', () => {
  it('ends the old enrolment the day before and starts one in the new class', async () => {
    const { patch, enrolment, start, classB, lastAudit, api } = await setup();
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      transfer: { classId: classB.id, startDate: monday(start, 4), priceOverride: nzd(40000) },
    });
    expect(res.status).toBe(200);
    expect(res.body.enrolment).toMatchObject({
      status: 'withdrawn',
      endDate: addDays(monday(start, 4), -1),
    });
    expect(res.body.transferredTo).toMatchObject({
      id: expect.stringMatching(/^enr_/),
      classId: classB.id,
      className: 'Group B',
      startDate: monday(start, 4),
      endDate: null,
      status: 'active',
      priceOverride: nzd(40000),
    });
    expect(await lastAudit()).toMatchObject({
      action: 'enrolment.transferred',
      entityId: enrolment.id,
      after: { status: 'withdrawn', transferredTo: { id: res.body.transferredTo.id } },
    });
    const roster = (await api('GET', `/enrolments?classId=${classB.id}`)).body.data;
    expect(roster).toHaveLength(1);
  });

  it('bills the old class and the new one pro rata, once a run bills the new enrolment', async () => {
    const { patch, enrolment, start, classB, runTerm, invoices } = await setup();
    await runTerm();
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      transfer: { classId: classB.id, startDate: monday(start, 4) },
    });
    // The old line keeps four lessons of ten.
    expect(res.body.invoices).toEqual([
      expect.objectContaining({ adjusted: true, lessonsAfter: 4, after: nzd(18000) }),
    ]);
    // Running again bills only what is new: six lessons in class B, on another invoice.
    await runTerm();
    const all = await invoices();
    const totals = all.map((invoice) => invoice.total.amount).sort((a, b) => a - b);
    expect(totals).toEqual([18000, 27000]);
  });

  it('refuses the same class, a class out of reach, a full one, and a student already there', async () => {
    const { patch, enrolment, classA, classB, start, addClass, make, aroha, member, main } =
      await setup();
    const same = await patch({ updatedAt: enrolment.updatedAt, transfer: { classId: classA.id } });
    expect(same.status).toBe(422);
    expect(same.body.error.fields).toEqual({ 'transfer.classId': ['Same class'] });

    const missing = await patch({
      updatedAt: enrolment.updatedAt,
      transfer: { classId: 'cls_missing' },
    });
    expect(missing.status).toBe(404);

    const full = await addClass('Group C', { capacity: 1 });
    const other = await make('/families', { name: 'Ngata', branchId: main.id });
    const ari = await make('/students', {
      familyId: other.id,
      firstName: 'Ari',
      lastName: 'Ngata',
    });
    await make('/enrolments', { studentId: ari.id, classId: full.id });
    const refusedFull = await patch({
      updatedAt: enrolment.updatedAt,
      transfer: { classId: full.id },
    });
    expect(refusedFull.status).toBe(422);
    expect(refusedFull.body.error.fields).toEqual({ 'transfer.classId': ['Full'] });

    await make('/enrolments', { studentId: aroha.id, classId: classB.id });
    const twice = await patch({ updatedAt: enrolment.updatedAt, transfer: { classId: classB.id } });
    expect(twice.status).toBe(409);

    const before = await patch({
      updatedAt: enrolment.updatedAt,
      transfer: { classId: full.id, startDate: addDays(start, -1) },
    });
    expect(before.status).toBe(422);

    // Branch staff limited to another branch don't reach the enrolment at all.
    const albany = await make('/branches', { name: 'Albany' });
    const desk = await member('front_desk', [albany.id]);
    const outOfReach = await patch({ updatedAt: enrolment.updatedAt, endDate: null }, desk.as);
    expect(outOfReach.status).toBe(404);
  });
});

describe('who may change an enrolment', () => {
  it('is staff who write classes: 403 for a teacher, parent and accountant', async () => {
    const { patch, enrolment, member, main } = await setup();
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      const someone = await member(role);
      expect((await patch({ updatedAt: enrolment.updatedAt }, someone.as)).status).toBe(403);
    }
    const desk = await member('front_desk', [main.id]);
    expect((await patch({ updatedAt: enrolment.updatedAt }, desk.as)).status).toBe(200);
  });

  it('is 404 for another org and for an id the org doesn’t have', async () => {
    const { patch, enrolment, base } = await setup();
    expect((await patch({ updatedAt: enrolment.updatedAt }, undefined, 'enr_missing')).status).toBe(
      404,
    );
    const stranger = await newUser('owner_b');
    await newOrg(stranger.token, 'Harmony Music School');
    const res = await call('PATCH', `${base}/enrolments/${enrolment.id}`, {
      token: stranger.token,
      body: { updatedAt: enrolment.updatedAt },
    });
    expect(res.status).toBe(404);
  });

  it('reads in at most two stages before its write', async () => {
    const { patch, enrolment, start } = await setup();
    const res = await patch({
      updatedAt: enrolment.updatedAt,
      status: 'withdrawn',
      endDate: monday(start, 2),
    });
    expect(res.db.stages).toBeLessThanOrEqual(4);
  });
});

describe('rosters keep a withdrawn student on the lessons before they left', () => {
  it('lists them on a lesson before their last day, and not after', async () => {
    const { patch, enrolment, start, api, classA, aroha } = await setup();
    await patch({ updatedAt: enrolment.updatedAt, status: 'withdrawn', endDate: monday(start, 1) });
    const sessions = (
      await api('GET', `/sessions?classId=${classA.id}&from=${start}&to=${monday(start, 3)}`)
    ).body.data as { id: string; date: string }[];
    const rosterOn = async (date: string) => {
      const session = sessions.find((s) => s.date === date)!;
      return (
        (await api('GET', `/sessions/${session.id}/attendance`)).body.records as {
          studentId: string;
        }[]
      ).map((r) => r.studentId);
    };
    expect(await rosterOn(monday(start, 1))).toEqual([aroha.id]);
    expect(await rosterOn(monday(start, 2))).toEqual([]);
  });
});
