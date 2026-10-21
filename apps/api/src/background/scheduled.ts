import { createDb, idempotencyKeys, type Db } from '@edustrux/db';
import { localNow } from '@edustrux/shared';
import { lt } from 'drizzle-orm';
import type { OrgCtx } from '../db/scope';
import type { Bindings } from '../env';
import * as attendance from '../modules/attendance/service';
import * as billing from '../modules/billing/service';
import * as comms from '../modules/comms/service';
import * as orgs from '../modules/orgs/service';

const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The local hours the hourly cron expires make-up credits in: midnight, and the hour after it in
 * case a daylight-saving change skips midnight. Expiring is idempotent, so twice does no harm.
 */
const CREDIT_EXPIRY_HOURS = [0, 1];

export async function handleScheduled(
  controller: ScheduledController,
  env: Bindings,
): Promise<void> {
  const db = createDb(env.DB);

  switch (controller.cron) {
    case '0 * * * *':
      await runHourly(db, env, new Date(controller.scheduledTime));
      break;

    case '0 3 * * *': {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_KEY_TTL_MS).toISOString();
      await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
      // TODO(classes): extend generated sessions ahead.
      // TODO(platform): clean expired files and links; nightly per-org export to R2.
      break;
    }

    default:
      console.warn(`Unhandled cron: ${controller.cron}`);
  }
}

/**
 * The hourly cron (TUI-67). For each org whose local hour matches: make-up credits past their
 * last day expire at midnight, and overdue reminders go out at the org's reminder hour. An org
 * that fails is logged and the rest carry on.
 */
export async function runHourly(db: Db, env: Bindings, at: Date) {
  const list = await orgs.orgsForCron(db);
  const settingsOf = await comms.settingsOf(
    db,
    list.map((org) => org.id),
  );
  const done = { creditsExpired: 0, remindersQueued: 0, failed: 0 };
  for (const org of list) {
    const ctx: OrgCtx = { db, orgId: org.id, actorUserId: null };
    const { date: today, time } = localNow(org.timezone, at);
    const hour = Number(time.slice(0, 2));
    const settings = settingsOf(org.id);
    try {
      if (CREDIT_EXPIRY_HOURS.includes(hour)) {
        done.creditsExpired += await attendance.expireCredits(ctx, today);
      }
      if (settings.overdueReminders && hour === settings.reminderHour) {
        const { reminded } = await billing.remindOverdue(
          ctx,
          env.EMAIL_QUEUE,
          settings.overdueReminderDays,
          today,
        );
        done.remindersQueued += reminded;
      }
    } catch (err) {
      done.failed++;
      console.error(`hourly cron: org ${org.id} failed`, err);
    }
  }
  return done;
}
