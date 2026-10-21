import type { Db } from '@edustrux/db';
import {
  PLAN_STUDENT_LIMITS,
  localNow,
  newId,
  orgCanWrite,
  type BillingInterval,
  type BillingOverview,
  type CreateCheckout,
  type Subscription,
  type SubscriptionStatus,
} from '@edustrux/shared';
import { z } from '@hono/zod-openapi';
import type { OrgCtx } from '../../db/scope';
import type { Bindings } from '../../env';
import { unavailable, unprocessable } from '../../lib/errors';
import * as paddle from '../../lib/paddle';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as repo from './repository';

// The org's subscription to EduStrux through Paddle (TUI-73). The owner subscribes through a
// Paddle checkout and manages it in Paddle's customer portal; Paddle's webhook keeps the
// subscription, and with it the org's plan and status, in step.

/** Subscriptions that are still the org's: a new checkout would start a second. */
const LIVE: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'paused'];

function toSubscription(row: repo.SubscriptionRow): Subscription {
  return {
    plan: row.plan,
    interval: row.interval,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAt: row.cancelAt,
  };
}

/** The org's plan, whether it can change anything, its use of the plan, and its subscription. */
export async function overview(ctx: OrgCtx): Promise<BillingOverview> {
  const org = await orgs.getOrg(ctx);
  const [row, usage] = await Promise.all([
    repo.latest(ctx),
    enrolment.planUsage(ctx, localNow(org.timezone).date),
  ]);
  return {
    plan: org.plan,
    status: org.status,
    trialEndsAt: org.trialEndsAt,
    canWrite: orgCanWrite(org),
    studentLimit: PLAN_STUDENT_LIMITS[org.plan],
    activeStudents: usage.count,
    subscription: row ? toSubscription(row) : null,
  };
}

/** Starts a Paddle checkout for a plan. An org with a live subscription changes it in the portal. */
export async function checkout(ctx: OrgCtx, env: Bindings, input: CreateCheckout) {
  const priceId = paddle.priceIds(env)[`${input.plan}_${input.interval}`];
  if (!priceId) throw unavailable('This plan isn’t on sale yet.');
  const row = await repo.latest(ctx);
  if (row && LIVE.includes(row.status)) {
    throw unprocessable('The organisation already has a subscription: change it in the portal.', {
      plan: ['Already subscribed'],
    });
  }
  return paddle.createCheckout(env, {
    priceId,
    orgId: ctx.orgId,
    customerId: row?.paddleCustomerId ?? null,
  });
}

/** A link into Paddle's portal for the org's subscription. */
export async function portal(ctx: OrgCtx, env: Bindings) {
  const row = await repo.latest(ctx);
  if (!row) throw unprocessable('The organisation has no subscription yet.');
  return paddle.createPortalSession(env, {
    customerId: row.paddleCustomerId,
    subscriptionId: row.paddleSubscriptionId,
  });
}

// ── Paddle's webhook ────────────────────────────────────────────────────────

export const PaddleSubscription = z.object({
  id: z.string(),
  status: z.enum(['active', 'trialing', 'past_due', 'paused', 'canceled']),
  customer_id: z.string(),
  items: z
    .array(
      z.object({
        price: z.object({
          id: z.string(),
          billing_cycle: z.object({ interval: z.string() }).nullable().optional(),
        }),
      }),
    )
    .min(1),
  custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
  current_billing_period: z.object({ ends_at: z.string() }).nullable().optional(),
  scheduled_change: z
    .object({ action: z.string(), effective_at: z.string() })
    .nullable()
    .optional(),
  canceled_at: z.string().nullable().optional(),
});
export type PaddleSubscription = z.infer<typeof PaddleSubscription>;

/** The org's status while its subscription is in Paddle's. */
const ORG_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  paused: 'suspended',
  canceled: 'cancelled',
} as const;

/**
 * Applies a `subscription.*` event. The org is the one the subscription is stored for, or for a
 * new one the `org_id` its checkout carried. An event older than the last one applied is ignored,
 * as Paddle doesn't promise order. The org's plan and status follow its newest subscription only.
 * Returns what it did, for the log.
 */
export async function applyPaddleSubscription(
  db: Db,
  env: Bindings,
  data: PaddleSubscription,
  occurredAt: string,
): Promise<'saved' | 'stale' | 'no_org'> {
  const before = await repo.findByPaddleId(db, data.id);
  const orgId =
    before?.orgId ??
    (typeof data.custom_data?.org_id === 'string' ? data.custom_data.org_id : null);
  if (!orgId) return 'no_org';
  const org = await orgs.findOrgById(db, orgId);
  if (!org || org.deletedAt) return 'no_org';
  if (before && before.eventAt > occurredAt) return 'stale';

  const ctx: OrgCtx = { db, orgId, actorUserId: null };
  const price = data.items[0]!.price;
  const plan: 'solo' | 'small' | 'custom' =
    (Object.entries(paddle.priceIds(env))
      .find(([, id]) => id === price.id)?.[0]
      .split('_')[0] as 'solo' | 'small' | undefined) ?? 'custom';
  const interval = price.billing_cycle?.interval;
  const newest = await repo.latest(ctx);
  // A new subscription's id sorts after every one the org had, so it is the newest.
  const isNewest = !before || !newest || newest.id === before.id;
  const row = {
    id: before?.id ?? newId('orgSubscription'),
    orgId,
    paddleSubscriptionId: data.id,
    paddleCustomerId: data.customer_id,
    plan,
    interval: interval === 'month' || interval === 'year' ? (interval as BillingInterval) : null,
    status: data.status,
    currentPeriodEnd: data.current_billing_period?.ends_at ?? null,
    cancelAt:
      data.scheduled_change?.action === 'cancel'
        ? data.scheduled_change.effective_at
        : (data.canceled_at ?? null),
    eventAt: occurredAt,
  };
  await repo.save(
    ctx,
    before,
    row,
    isNewest ? [orgs.setPlanStatement(db, orgId, { plan, status: ORG_STATUS[data.status] })] : [],
  );
  return 'saved';
}
