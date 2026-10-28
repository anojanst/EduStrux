---
id: TUI-106
title: Switch subscription billing from Paddle to Stripe
status: done
phase: P5
module: platform
priority: P0
size: M
endpoints:
  - POST /api/v1/orgs/{orgId}/billing/checkout
  - POST /api/v1/orgs/{orgId}/billing/portal
  - POST /api/v1/webhooks/stripe
branch: task/tui-106-stripe-billing
pr: 75
---

# TUI-106 Switch subscription billing from Paddle to Stripe

The owner chose Stripe over Paddle on 2026-10-22 (D-157). TUI-73 was built on Paddle (D-152); swap it before launch, keeping the plan limits and read-only rules (D-153), which don't depend on the provider.

- Replace `apps/api/src/lib/paddle.ts` with a Stripe client: Checkout Sessions for `POST /billing/checkout`, the Billing Portal for `POST /billing/portal`.
- Replace `POST /api/v1/webhooks/paddle` with `POST /api/v1/webhooks/stripe` (Stripe-Signature check, `customer.subscription.*` events), deduplicated in `webhook_events`.
- `org_subscriptions`: rename the Paddle id columns to provider-neutral or Stripe ones (migration); map Stripe statuses (`active`, `trialing`, `past_due`, `unpaid`, `paused`, `canceled`, `incomplete`) to the org's status.
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids by plan and interval.
- Sales tax: Stripe isn't merchant of record, so decide on Stripe Tax and where to register (see D-157).
- Update the handoff (§1 stack and costs, §9, §10) and D-027's local prices.

Built on Stripe in D-186 (supersedes D-152). The sales-tax choice stays open: `STRIPE_AUTOMATIC_TAX=true` turns Stripe Tax on without a code change (handoff §11).
