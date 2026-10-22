import { z } from '../zod';
import { Timestamp } from './common';
import { OrgPlan, OrgStatus } from './orgs';

// The org's own subscription to EduStrux, through Paddle (TUI-73), and its plan's limits (TUI-74).

export const PAID_PLANS = ['solo', 'small'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
/** Paddle's subscription statuses. */
export const SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'paused',
  'canceled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * The most students each plan holds at once, counting students with an enrolment that is active
 * today or later. A trial has the Small plan's room; custom has no cap.
 */
export const PLAN_STUDENT_LIMITS: Record<z.infer<typeof OrgPlan>, number | null> = {
  trial: 150,
  solo: 30,
  small: 150,
  custom: null,
};

/**
 * Whether the org can change anything: not once a trial has ended with no subscription, nor
 * while it is suspended or cancelled. Reading, exporting and subscribing still work (TUI-74).
 * A payment that is late (`past_due`) doesn't stop it while Paddle retries.
 */
export function orgCanWrite(
  org: { status: z.infer<typeof OrgStatus>; trialEndsAt: string | null },
  now: Date = new Date(),
) {
  if (org.status === 'suspended' || org.status === 'cancelled') return false;
  if (org.status === 'trialing')
    return org.trialEndsAt === null || org.trialEndsAt > now.toISOString();
  return true;
}

export const Subscription = z
  .object({
    plan: OrgPlan,
    interval: z.enum(BILLING_INTERVALS).nullable(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    currentPeriodEnd: Timestamp.nullable(),
    cancelAt: Timestamp.nullable().openapi({
      description: 'When a cancellation the owner asked for takes effect.',
    }),
  })
  .openapi('Subscription');
export type Subscription = z.infer<typeof Subscription>;

export const BillingOverview = z
  .object({
    plan: OrgPlan,
    status: OrgStatus,
    trialEndsAt: Timestamp.nullable(),
    /** false while the trial has ended with no subscription, or the org is suspended or cancelled. */
    canWrite: z.boolean().openapi({
      description:
        'false once the trial has ended with no subscription, or when the org is suspended or ' +
        'cancelled: then only reads, billing and exports work.',
    }),
    studentLimit: z.number().int().nullable(),
    activeStudents: z.number().int(),
    subscription: Subscription.nullable(),
  })
  .openapi('BillingOverview');
export type BillingOverview = z.infer<typeof BillingOverview>;

export const CreateCheckout = z
  .object({
    plan: z.enum(PAID_PLANS),
    interval: z.enum(BILLING_INTERVALS).default('month'),
  })
  .openapi('CreateCheckout');
export type CreateCheckout = z.infer<typeof CreateCheckout>;

export const Checkout = z
  .object({
    transactionId: z.string().openapi({ description: 'Open it with Paddle.js.' }),
    checkoutUrl: z.string().nullable(),
  })
  .openapi('Checkout');

export const BillingPortal = z.object({ url: z.string() }).openapi('BillingPortal');
