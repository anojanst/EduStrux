import { webhookEvents, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, eq, lt } from 'drizzle-orm';

// The deliveries the webhooks have handled, by the sender's own id, so a delivery sent again is
// handled once (TUI-71). Not org data: a delivery may concern no org, or several.

export type WebhookSource = 'clerk' | 'resend' | 'stripe';

export async function seen(db: Db, source: WebhookSource, eventId: string) {
  const row = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, source), eq(webhookEvents.eventId, eventId)))
    .get();
  return row !== undefined;
}

/** Two deliveries at once can both get here; the unique index keeps one row. */
export async function record(db: Db, source: WebhookSource, eventId: string, type: string) {
  await db
    .insert(webhookEvents)
    .values({ id: newId('webhookEvent'), source, eventId, type })
    .onConflictDoNothing();
}

/** Drops the record of deliveries older than `before`, for the daily cron. */
export function forget(db: Db, before: string) {
  return db.delete(webhookEvents).where(lt(webhookEvents.createdAt, before));
}
