---
id: TUI-73
title: Paddle subscription billing + webhook
status: todo
phase: P5
module: platform
priority: P0
size: L
endpoints:
  - GET /billing/subscription
  - POST /billing/checkout
  - POST /billing/portal
  - POST /api/v1/webhooks/paddle
branch:
pr:
---

# TUI-73 Paddle subscription billing + webhook

org_subscriptions table. Solo $9.90, Small $24.90; annual $99 and $249; round NZD, AUD and GBP prices (D-027). Webhook updates plan, limits, status.
