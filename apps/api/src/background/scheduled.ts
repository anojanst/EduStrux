import { createDb, type Db } from '@edustrux/db';
import { localNow, orgCanWrite } from '@edustrux/shared';
import type { OrgCtx } from '../db/scope';
import type { Bindings } from '../env';
import { forgetOldKeys } from '../middleware/idempotency';
import * as attendance from '../modules/attendance/service';
import * as billing from '../modules/billing/service';
import * as classes from '../modules/classes/service';
import * as comms from '../modules/comms/service';
import * as orgs from '../modules/orgs/service';
import * as exports from '../modules/platform/exports';
import * as files from '../modules/platform/files';
import * as privacy from '../modules/privacy/service';
import * as webhooks from '../modules/webhooks/service';

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

    case '0 3 * * *':
      await runDaily(db, env, new Date(controller.scheduledTime));
      break;

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
  const list = (await orgs.orgsForCron(db)).filter((org) => orgCanWrite(org, at));
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

/**
 * The daily cron (TUI-68): drops stale idempotency keys, webhook records and expired files, then for each org
 * extends its open-ended classes' sessions and starts its nightly backup job, erases its inactive
 * families, and deletes erased ones whose money is past the org's retention (TUI-118). An org
 * that fails is logged and the rest carry on.
 */
export async function runDaily(db: Db, env: Bindings, at: Date) {
  const cutoff = new Date(at.getTime() - IDEMPOTENCY_KEY_TTL_MS).toISOString();
  await forgetOldKeys(db, cutoff);
  await webhooks.forgetOldDeliveries(db, at);
  const done = {
    filesRemoved: 0,
    sessionsAdded: 0,
    backupsStarted: 0,
    familiesErased: 0,
    familiesPurged: 0,
    failed: 0,
  };
  try {
    done.filesRemoved = await files.cleanExpired(db, env);
  } catch (err) {
    console.error('daily cron: cleaning expired files failed', err);
  }
  for (const org of await orgs.orgsForCron(db)) {
    const ctx: OrgCtx = { db, orgId: org.id, actorUserId: null };
    const today = localNow(org.timezone, at).date;
    try {
      if (orgCanWrite(org, at)) {
        done.sessionsAdded += await classes.extendOpenEnded(ctx, at);
        await exports.startBackup(ctx, env.JOBS_QUEUE, today);
        done.backupsStarted++;
      }
      // Erasing runs whether or not the org can write: a lapsed trial still holds families.
      done.familiesErased += await privacy.eraseInactive(ctx, today);
      if (org.financialRetentionYears) {
        done.familiesPurged += await privacy.purgeExpired(ctx, org.financialRetentionYears, today);
      }
    } catch (err) {
      done.failed++;
      console.error(`daily cron: org ${org.id} failed`, err);
    }
  }
  return done;
}
