import type { Db } from '@edustrux/db';
import {
  PLAN_STUDENT_LIMITS,
  localNow,
  newId,
  orgCanWrite,
  type BillingInterval,
  SUBSCRIPTION_STATUSES,
  type BillingOverview,
  type CreateCheckout,
  type Subscription,
  type SubscriptionStatus,
} from '@edustrux/shared';
import { z } from '@hono/zod-openapi';
import type { OrgCtx } from '../../db/scope';
import type { Bindings } from '../../env';
import { unavailable, unprocessable } from '../../lib/errors';
import * as stripe from '../../lib/stripe';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as repo from './repository';

// The org's subscription to EduStrux through Stripe (TUI-106; built on Paddle in TUI-73). The
// owner subscribes through a Stripe Checkout Session and manages it in Stripe's Billing Portal;
// Stripe's webhook keeps the subscription, and with it the org's plan and status, in step.

/**
 * Subscriptions that are still the org's: a new checkout would start a second. One stuck
 * `incomplete` isn't: it lapses on its own, and the owner may try again.
 */
const LIVE: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

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

/** Starts a Stripe checkout for a plan. An org with a live subscription changes it in the portal. */
export async function checkout(ctx: OrgCtx, env: Bindings, input: CreateCheckout) {
  const priceId = stripe.priceIds(env)[`${input.plan}_${input.interval}`];
  if (!priceId) throw unavailable('This plan isn’t on sale yet.');
  const row = await repo.latest(ctx);
  if (row && LIVE.includes(row.status)) {
    throw unprocessable('The organisation already has a subscription: change it in the portal.', {
      plan: ['Already subscribed'],
    });
  }
  const org = await orgs.getOrg(ctx);
  return stripe.createCheckout(env, {
    priceId,
    orgId: ctx.orgId,
    orgSlug: org.slug,
    customerId: row?.stripeCustomerId ?? null,
  });
}

/** A link into Stripe's Billing Portal for the org's Stripe customer. */
export async function portal(ctx: OrgCtx, env: Bindings) {
  const row = await repo.latest(ctx);
  if (!row) throw unprocessable('The organisation has no subscription yet.');
  const org = await orgs.getOrg(ctx);
  return stripe.createPortalSession(env, { customerId: row.stripeCustomerId, orgSlug: org.slug });
}

// ── Stripe's webhook ────────────────────────────────────────────────────────

/** A Unix time in seconds, as Stripe sends times, as ISO UTC. */
const iso = (seconds: number | null | undefined) =>
  seconds == null ? null : new Date(seconds * 1000).toISOString();

const StripeItem = z.object({
  price: z.object({
    id: z.string(),
    recurring: z.object({ interval: z.string() }).nullable().optional(),
  }),
  // Where API versions from 2025-03-31 put the period; older ones put it on the subscription.
  current_period_end: z.number().optional(),
});

export const StripeSubscription = z.object({
  id: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  customer: z.string(),
  items: z.object({ data: z.array(StripeItem).min(1) }),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  current_period_end: z.number().optional(),
  cancel_at: z.number().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  canceled_at: z.number().nullable().optional(),
});
export type StripeSubscription = z.infer<typeof StripeSubscription>;

/**
 * The org's status while its subscription is in Stripe's. `unpaid` (Stripe has stopped retrying
 * a failed payment) makes the org read-only, as `paused` does. While the first payment is
 * `incomplete`, or after it never came (`incomplete_expired`), the org keeps its trial: null.
 */
const ORG_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'suspended',
  paused: 'suspended',
  canceled: 'cancelled',
  incomplete: null,
  incomplete_expired: null,
} as const;

/**
 * Applies a `customer.subscription.*` event. The org is the one the subscription is stored for,
 * or for a new one the `org_id` its checkout put in the subscription's metadata. An event older
 * than the last one applied is ignored, as Stripe doesn't promise order. The org's plan and status
 * follow its newest subscription only, once its first payment has gone through.
 * Returns what it did, for the log.
 */
export async function applyStripeSubscription(
  db: Db,
  env: Bindings,
  data: StripeSubscription,
  occurredAt: string,
): Promise<'saved' | 'stale' | 'no_org'> {
  const before = await repo.findByStripeId(db, data.id);
  const orgId = before?.orgId ?? data.metadata?.org_id ?? null;
  if (!orgId) return 'no_org';
  const org = await orgs.findOrgById(db, orgId);
  if (!org || org.deletedAt) return 'no_org';
  if (before && before.eventAt > occurredAt) return 'stale';

  const ctx: OrgCtx = { db, orgId, actorUserId: null };
  const item = data.items.data[0]!;
  const plan: 'solo' | 'small' | 'custom' =
    (Object.entries(stripe.priceIds(env))
      .find(([, id]) => id === item.price.id)?.[0]
      .split('_')[0] as 'solo' | 'small' | undefined) ?? 'custom';
  const interval = item.price.recurring?.interval;
  const newest = await repo.latest(ctx);
  // A new subscription's id sorts after every one the org had, so it is the newest.
  const isNewest = !before || !newest || newest.id === before.id;
  const status = ORG_STATUS[data.status];
  const periodEnd = item.current_period_end ?? data.current_period_end;
  const row = {
    id: before?.id ?? newId('orgSubscription'),
    orgId,
    stripeSubscriptionId: data.id,
    stripeCustomerId: data.customer,
    plan,
    interval: interval === 'month' || interval === 'year' ? (interval as BillingInterval) : null,
    status: data.status,
    currentPeriodEnd: iso(periodEnd),
    // Older API versions only flag a cancellation at the period's end, without `cancel_at`.
    cancelAt: iso(data.cancel_at ?? (data.cancel_at_period_end ? periodEnd : data.canceled_at)),
    eventAt: occurredAt,
  };
  await repo.save(
    ctx,
    before,
    row,
    isNewest && status ? [orgs.setPlanStatement(db, orgId, { plan, status })] : [],
  );
  return 'saved';
}
