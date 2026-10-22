import { BILLING_INTERVALS, SUBSCRIPTION_STATUSES } from '@edustrux/shared';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// The org's subscription to EduStrux in Paddle (TUI-73), kept in step by Paddle's webhook. An org
// that subscribes again after cancelling gets another row; the newest is its subscription.
export const orgSubscriptions = sqliteTable(
  'org_subscriptions',
  {
    ...orgColumns(),
    paddleSubscriptionId: text('paddle_subscription_id').notNull(),
    paddleCustomerId: text('paddle_customer_id').notNull(),
    // The plan its price is for: `solo`, `small`, or `custom` for a price not in PADDLE_PRICE_IDS.
    plan: text('plan', { enum: ['solo', 'small', 'custom'] }).notNull(),
    interval: text('interval', { enum: BILLING_INTERVALS }),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    currentPeriodEnd: text('current_period_end'),
    cancelAt: text('cancel_at'),
    // When the event last applied happened, so an older one arriving late is ignored.
    eventAt: text('event_at').notNull(),
  },
  (t) => [
    uniqueIndex('org_subscriptions_paddle_uq').on(t.paddleSubscriptionId),
    index('org_subscriptions_org_idx').on(t.orgId, t.id),
  ],
);
