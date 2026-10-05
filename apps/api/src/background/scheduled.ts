import { createDb, idempotencyKeys } from '@edustrux/db';
import { lt } from 'drizzle-orm';
import type { Bindings } from '../env';

const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export async function handleScheduled(
  controller: ScheduledController,
  env: Bindings,
): Promise<void> {
  const db = createDb(env.DB);

  switch (controller.cron) {
    case '0 * * * *':
      // TODO(billing): overdue invoice reminders for orgs whose local time matches.
      // TODO(attendance): expire make-up credits.
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
