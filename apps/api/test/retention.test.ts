import {
  attendance,
  auditLog,
  enrolments,
  families,
  guardians,
  invoiceLines,
  invoices,
  memberships,
  paymentAllocations,
  payments,
  sessions,
  students,
} from '@edustrux/db';
import { addMonths, localNow, localToUtc, newId, type Role } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { runDaily } from '../src/background/scheduled';
import { call, db, newOrg, newUser } from './helpers';

// Erasing inactive families after 6 months, and deleting erased families' money records once the
// org's retention has passed (TUI-118, D-171). Both run in the daily cron.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
/** Noon on a date, in the org's time zone. */
const noonOn = (date: string) => new Date(localToUtc(date, '12:00', TZ));
/** Seven months from now: a family made today has been around for more than 6 months. */
const later = () => addMonths(today(), 7);
/** A date `months` months before the day the cron runs. */
const beforeLater = (months: number) => addMonths(later(), -months);

type Row = { id: string; updatedAt: string };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown, token = owner.token) =>
    call(method, `${base}${path}`, { token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const family = async (name: string) => {
    const f = await make('/families', { name, branchId: main.id });
    const g = await make(`/families/${f.id}/guardians`, {
      firstName: 'Mere',
      lastName: name,
      email: `mere.${name.toLowerCase()}@example.com`,
    });
    const s = await make('/students', { familyId: f.id, firstName: 'Aroha', lastName: name });
    return { id: f.id, guardianId: g.id, studentId: s.id };
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
    return user.token;
  };

  // Rows written straight to D1, dated as each case needs.
  const enrol = (studentId: string, startDate: string, endDate: string | null) =>
    db()
      .insert(enrolments)
      .values({
        id: newId('enrolment'),
        orgId: org.id,
        studentId,
        classId: 'cls_test',
        startDate,
        endDate,
        status: endDate ? 'withdrawn' : 'active',
      });
  const marked = async (studentId: string, date: string) => {
    const sessionId = newId('session');
    await db().insert(sessions).values({
      id: sessionId,
      orgId: org.id,
      classId: 'cls_test',
      date,
      startTime: '16:00',
      endTime: '17:00',
    });
    await db()
      .insert(attendance)
      .values({ id: newId('attendance'), orgId: org.id, sessionId, studentId, status: 'present' });
  };
  /**
   * An issued invoice for the month ending `periodEnd`, made that day, paid by `paid` (all of it
   * by default) on the same day.
   */
  const invoice = async (familyId: string, periodEnd: string, paid = 1000) => {
    const id = newId('invoice');
    await db()
      .insert(invoices)
      .values({
        id,
        orgId: org.id,
        familyId,
        status: 'issued',
        periodStart: addMonths(periodEnd, -1),
        periodEnd,
        currency: 'NZD',
        subtotalAmount: 1000,
        taxAmount: 0,
        totalAmount: 1000,
        createdAt: `${periodEnd}T00:00:00.000Z`,
      });
    await db()
      .insert(invoiceLines)
      .values({
        id: newId('invoiceLine'),
        orgId: org.id,
        invoiceId: id,
        enrolmentId: newId('enrolment'),
        studentId: 'stu_test',
        classId: 'cls_test',
        periodKey: periodEnd.slice(0, 7),
        periodStart: addMonths(periodEnd, -1),
        periodEnd,
        basis: 'per_month',
        unitAmount: 1000,
        quantity: 1,
        lessons: 4,
        subtotalAmount: 1000,
        taxAmount: 0,
        totalAmount: 1000,
      });
    if (paid > 0) await pay(familyId, periodEnd, paid, id);
    return id;
  };
  const pay = async (familyId: string, receivedOn: string, amount: number, invoiceId?: string) => {
    const id = newId('payment');
    await db()
      .insert(payments)
      .values({
        id,
        orgId: org.id,
        familyId,
        method: 'cash',
        amount,
        currency: 'NZD',
        receivedOn,
        createdAt: `${receivedOn}T00:00:00.000Z`,
      });
    if (invoiceId) {
      await db()
        .insert(paymentAllocations)
        .values({
          id: newId('paymentAllocation'),
          orgId: org.id,
          paymentId: id,
          invoiceId,
          amount,
        });
      await db()
        .update(invoices)
        .set({ paidAmount: amount, status: amount >= 1000 ? 'paid' : 'part_paid' })
        .where(eq(invoices.id, invoiceId));
    }
    return id;
  };
  const familyRow = (id: string) => db().select().from(families).where(eq(families.id, id)).get();
  const erased = async (id: string) => (await familyRow(id))?.erasedAt != null;
  return { org, api, family, member, enrol, marked, invoice, pay, familyRow, erased };
}

describe('erasing inactive families', () => {
  it('erases a family 6 months after it goes inactive, with auto: true on its audit row', async () => {
    const { org, family, erased, enrol, invoice, api } = await setup();
    const quiet = await family('Quiet');
    // Old activity only: an enrolment, an invoice paid in full, all over 6 months before.
    await enrol(quiet.studentId, addMonths(today(), -3), beforeLater(7));
    await invoice(quiet.id, beforeLater(8));
    const deleted = await family('Deleted');
    await api('DELETE', `/families/${deleted.id}`);

    // Today, nothing has been around for 6 months.
    expect((await runDaily(db(), env, new Date())).familiesErased).toBe(0);
    expect(await erased(quiet.id)).toBe(false);

    const done = await runDaily(db(), env, noonOn(later()));
    expect(done.familiesErased).toBe(2);
    expect(await erased(quiet.id)).toBe(true);
    expect(await erased(deleted.id)).toBe(true);
    const guardian = await db()
      .select()
      .from(guardians)
      .where(eq(guardians.id, quiet.guardianId))
      .get();
    expect(guardian).toMatchObject({ firstName: 'Erased', email: null });
    const audit = await db()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, org.id),
          eq(auditLog.action, 'family.erased'),
          eq(auditLog.entityId, quiet.id),
        ),
      )
      .get();
    expect(audit).toMatchObject({ actorUserId: null, after: { auto: true, students: 1 } });

    // Again: nothing more to erase.
    expect((await runDaily(db(), env, noonOn(later()))).familiesErased).toBe(0);
  });

  it('keeps a family with any one sign of activity in the last 6 months', async () => {
    const { family, erased, enrol, marked, invoice, pay } = await setup();
    const running = await family('Running');
    await enrol(running.studentId, addMonths(today(), -3), null);
    const recentEnrolment = await family('Recent');
    await enrol(recentEnrolment.studentId, addMonths(today(), -3), beforeLater(2));
    const lesson = await family('Lesson');
    await marked(lesson.studentId, beforeLater(1));
    const owing = await family('Owing');
    await invoice(owing.id, beforeLater(10), 400);
    const recentInvoice = await family('Invoiced');
    await invoice(recentInvoice.id, beforeLater(3));
    const recentPayment = await family('Paid');
    await pay(recentPayment.id, beforeLater(2), 500);
    const control = await family('Control');
    await marked(control.studentId, beforeLater(8));

    await runDaily(db(), env, noonOn(later()));
    for (const kept of [running, recentEnrolment, lesson, owing, recentInvoice, recentPayment]) {
      expect(await erased(kept.id)).toBe(false);
    }
    expect(await erased(control.id)).toBe(true);
  });

  it('erases in an org whose trial has ended, which can no longer write', async () => {
    const { family, erased } = await setup();
    const quiet = await family('Quiet');
    // Seven months on, the org's 14-day trial has long ended and it has no subscription.
    const done = await runDaily(db(), env, noonOn(later()));
    expect(done.backupsStarted).toBe(0);
    expect(await erased(quiet.id)).toBe(true);
  });
});

describe('the financial retention setting', () => {
  it('is set by the owner, 1 to 10 years, and audited', async () => {
    const { org, api } = await setup();
    const before = (await api('GET', '')).body;
    expect(before.financialRetentionYears).toBeNull();
    const set = await api('PATCH', '', { updatedAt: before.updatedAt, financialRetentionYears: 7 });
    expect(set.status).toBe(200);
    expect(set.body.financialRetentionYears).toBe(7);
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({
      action: 'org.updated',
      entityId: org.id,
      before: { financialRetentionYears: null },
      after: { financialRetentionYears: 7 },
    });
    for (const bad of [0, 11, 2.5, '7']) {
      const res = await api('PATCH', '', {
        updatedAt: set.body.updatedAt,
        financialRetentionYears: bad,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toHaveProperty('financialRetentionYears');
    }
    const unset = await api('PATCH', '', {
      updatedAt: set.body.updatedAt,
      financialRetentionYears: null,
    });
    expect(unset.body.financialRetentionYears).toBeNull();
  });

  it('is refused to every other role, and to another org’s owner', async () => {
    const { api, member } = await setup();
    const { updatedAt } = (await api('GET', '')).body;
    for (const role of ['branch_manager', 'front_desk', 'accountant', 'teacher'] as const) {
      const token = await member(role);
      const res = await api('PATCH', '', { updatedAt, financialRetentionYears: 7 }, token);
      expect(res.status).toBe(403);
    }
    const other = await newUser('owner_b');
    await newOrg(other.token, 'Other Centre');
    const res = await api('PATCH', '', { updatedAt, financialRetentionYears: 7 }, other.token);
    expect(res.status).toBe(404);
  });
});

describe('deleting erased families for good', () => {
  async function erasedWithMoney() {
    const ctx = await setup();
    const f = await ctx.family('Perera');
    await ctx.enrol(f.studentId, addMonths(today(), -3), beforeLater(8));
    await ctx.marked(f.studentId, beforeLater(8));
    const invoiceId = await ctx.invoice(f.id, beforeLater(9));
    const recent = await ctx.family('Recent');
    await ctx.invoice(recent.id, beforeLater(9));
    await runDaily(db(), env, noonOn(later()));
    expect(await ctx.erased(f.id)).toBe(true);
    expect(await ctx.erased(recent.id)).toBe(true);
    return { ...ctx, f, invoiceId, recent };
  }

  it('deletes nothing while the org has no retention set', async () => {
    const { f, familyRow } = await erasedWithMoney();
    const done = await runDaily(db(), env, noonOn(addMonths(later(), 12 * 12)));
    expect(done.familiesPurged).toBe(0);
    expect(await familyRow(f.id)).toBeDefined();
    const left = await db().select().from(invoices).where(eq(invoices.familyId, f.id));
    expect(left).toHaveLength(1);
  });

  it('deletes all of a family once its newest money is older than the retention', async () => {
    const { org, api, f, invoiceId, recent, familyRow, invoice } = await erasedWithMoney();
    // The other family has money from later on, still within the period.
    await invoice(recent.id, addMonths(later(), 6));
    const { updatedAt } = (await api('GET', '')).body;
    await api('PATCH', '', { updatedAt, financialRetentionYears: 1 });

    // Within a year of the invoice's period end: kept.
    const soon = addMonths(later(), 2);
    expect((await runDaily(db(), env, noonOn(soon))).familiesPurged).toBe(0);
    expect(await familyRow(f.id)).toBeDefined();

    const done = await runDaily(db(), env, noonOn(addMonths(later(), 4)));
    expect(done.familiesPurged).toBe(1);
    expect(await familyRow(f.id)).toBeUndefined();
    expect(await familyRow(recent.id)).toBeDefined();
    const ofFamily = async (table: typeof guardians | typeof students) =>
      db().select().from(table).where(eq(table.familyId, f.id));
    expect(await ofFamily(guardians)).toHaveLength(0);
    expect(await ofFamily(students)).toHaveLength(0);
    expect(await db().select().from(invoices).where(eq(invoices.familyId, f.id))).toHaveLength(0);
    expect(await db().select().from(payments).where(eq(payments.familyId, f.id))).toHaveLength(0);
    const lines = await db()
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    expect(lines).toHaveLength(0);
    const allocations = await db()
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, invoiceId));
    expect(allocations).toHaveLength(0);
    const enrolled = await db().select().from(enrolments).where(eq(enrolments.orgId, org.id));
    expect(enrolled).toHaveLength(0);
    const marks = await db().select().from(attendance).where(eq(attendance.orgId, org.id));
    expect(marks).toHaveLength(0);

    const audit = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, org.id), eq(auditLog.action, 'family.purged')));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: f.id,
      actorUserId: null,
      after: { guardians: 1, students: 1, invoices: 1, payments: 1 },
    });
  });
});
