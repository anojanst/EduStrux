import { orgSubscriptions, type Db } from '@edustrux/db';
import { desc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type SubscriptionRow = typeof orgSubscriptions.$inferSelect;
export type NewSubscriptionRow = typeof orgSubscriptions.$inferInsert;

/** The org's newest subscription: the one that is its subscription now. */
export function latest(ctx: OrgCtx) {
  return ctx.db
    .select()
    .from(orgSubscriptions)
    .where(inOrg(ctx, orgSubscriptions))
    .orderBy(desc(orgSubscriptions.id))
    .limit(1)
    .get();
}

/** A subscription by Paddle's id, in whichever org: for Paddle's webhook. */
export function findByPaddleId(db: Db, paddleSubscriptionId: string) {
  return db
    .select()
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.paddleSubscriptionId, paddleSubscriptionId))
    .get();
}

/**
 * Stores what Paddle says of a subscription, adding it or updating it, with `also` (the org's new
 * plan and status) in the same batch and one audit row.
 */
export async function save(
  ctx: OrgCtx,
  before: SubscriptionRow | undefined,
  row: NewSubscriptionRow & { id: string },
  also: BatchItem<'sqlite'>[],
) {
  const { id, orgId: _org, ...fields } = row;
  await writeWithAudit(
    ctx,
    [
      before
        ? ctx.db
            .update(orgSubscriptions)
            .set(fields)
            .where(inOrg(ctx, orgSubscriptions, eq(orgSubscriptions.id, before.id)))
        : ctx.db.insert(orgSubscriptions).values(row),
      ...also,
    ],
    {
      action: before ? 'subscription.updated' : 'subscription.created',
      entityType: 'subscription',
      entityId: before?.id ?? id,
      before: before && {
        plan: before.plan,
        status: before.status,
        cancelAt: before.cancelAt,
      },
      after: { plan: row.plan, status: row.status, cancelAt: row.cancelAt ?? null },
    },
  );
}
