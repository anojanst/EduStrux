import { invoices, makeupCredits } from '@edustrux/db';
import { addDays, localNow, localToUtc, newId } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { runHourly } from '../src/background/scheduled';
import { call, db, newOrg, newUser } from './helpers';

// The hourly cron (TUI-67): overdue reminders at the org's reminder hour, credit expiry at
// midnight, each in the org's own time.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
/** The instant it is `time` today in the org's time zone. */
const at = (time: string) => new Date(localToUtc(today(), time, TZ));

type Automatic = { event: string; subject: string; body: string; recipientCount: number };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const main = (await api('GET', '/branches')).body.data[0] as { id: string };
  const family = (await api('POST', '/families', { name: 'Perera', branchId: main.id })).body;
  await api('POST', `/families/${family.id}/guardians`, {
    firstName: 'Mere',
    lastName: 'Perera',
    email: 'mere@example.com',
  });
  /** An issued invoice for the family, `late` days past its due date, with `paid` of $100. */
  const invoice = async (
    late: number,
    paid = 0,
    status: 'issued' | 'part_paid' | 'paid' = 'issued',
  ) => {
    const id = newId('invoice');
    await db()
      .insert(invoices)
      .values({
        id,
        orgId: org.id,
        familyId: family.id,
        status,
        periodStart: addDays(today(), -60),
        periodEnd: addDays(today(), -30),
        currency: 'NZD',
        subtotalAmount: 10000,
        taxAmount: 0,
        totalAmount: 10000,
        paidAmount: paid,
        bankReference: 'PERERA01',
        dueDate: addDays(today(), -late),
        issuedAt: new Date().toISOString(),
      });
    return id;
  };
  const remindedDays = async (id: string) =>
    (await db().select().from(invoices).where(eq(invoices.id, id)).get())!.remindedDays;
  const automatic = async () =>
    (await api('GET', '/messages?kind=automatic')).body.data as Automatic[];
  /** The automatic messages, once the email queue's consumer has written `count` of them. */
  const written = async (count: number) => {
    for (let i = 0; i < 200; i++) {
      const found = await automatic();
      if (found.length >= count) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${count} messages were written`);
  };
  return { org, api, family, invoice, remindedDays, automatic, written };
}

describe('overdue reminders', () => {
  it('remind once for each reminder day, at the reminder hour, and not for paid invoices', async () => {
    const { invoice, remindedDays, written, automatic, api } = await setup();
    const dayLate = await invoice(1);
    const weekLate = await invoice(8, 4000, 'part_paid');
    const longLate = await invoice(30);
    const paid = await invoice(1, 10000, 'paid');
    const notYet = await invoice(0);

    // Not the reminder hour (9 by default): nothing.
    await runHourly(db(), env, at('08:10'));
    expect(await remindedDays(dayLate)).toEqual([]);

    await runHourly(db(), env, at('09:05'));
    expect(await remindedDays(dayLate)).toEqual([1]);
    expect(await remindedDays(weekLate)).toEqual([1, 7]);
    // Its days passed long ago: marked, not sent.
    expect(await remindedDays(longLate)).toEqual([1, 7, 14]);
    expect(await remindedDays(paid)).toEqual([]);
    expect(await remindedDays(notYet)).toEqual([]);

    const messages = await written(2);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.subject).sort()).toEqual([
      'Reminder: $100.00 overdue',
      'Reminder: $60.00 overdue',
    ]);
    expect(messages[0]).toMatchObject({ event: 'invoice_overdue', recipientCount: 1 });
    expect(messages[0]!.body).toContain('PERERA01');

    // The same hour again (a redelivered cron): no second reminder.
    await runHourly(db(), env, at('09:40'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await automatic()).toHaveLength(2);

    const audit = (await api('GET', '/audit-log?limit=10')).body.data.find(
      (a: { action: string }) => a.action === 'invoices.reminded',
    );
    expect(audit).toMatchObject({ entityType: 'org', actorUserId: null });
  });

  it('follow the org’s settings: its hour, its days, or none', async () => {
    const { invoice, remindedDays, api } = await setup();
    const late = await invoice(3);
    const settings = {
      sessionChanges: true,
      invoiceIssued: true,
      overdueReminders: false,
      overdueReminderDays: [3],
      reminderHour: 16,
      replyToEmail: null,
    };
    expect((await api('PUT', '/notification-settings', settings)).status).toBe(200);
    await runHourly(db(), env, at('16:00'));
    expect(await remindedDays(late)).toEqual([]);

    await api('PUT', '/notification-settings', { ...settings, overdueReminders: true });
    await runHourly(db(), env, at('09:00'));
    expect(await remindedDays(late)).toEqual([]);
    await runHourly(db(), env, at('16:00'));
    expect(await remindedDays(late)).toEqual([3]);
  });
});

describe('make-up credit expiry', () => {
  it('expires credits past their last day, at the org’s midnight', async () => {
    const { org } = await setup();
    const credit = async (expiresOn: string | null) => {
      const id = newId('makeupCredit');
      await db()
        .insert(makeupCredits)
        .values({
          id,
          orgId: org.id,
          studentId: newId('student'),
          sessionId: newId('session'),
          classId: newId('class'),
          courseId: newId('course'),
          missedOn: addDays(today(), -30),
          expiresOn,
        });
      return id;
    };
    const status = async (id: string) =>
      (await db().select().from(makeupCredits).where(eq(makeupCredits.id, id)).get())!.status;
    const lapsed = await credit(addDays(today(), -1));
    const lastDay = await credit(today());
    const forever = await credit(null);

    await runHourly(db(), env, at('14:00'));
    expect(await status(lapsed)).toBe('available');

    await runHourly(db(), env, at('00:00'));
    expect(await status(lapsed)).toBe('expired');
    expect(await status(lastDay)).toBe('available');
    expect(await status(forever)).toBe('available');
  });
});
