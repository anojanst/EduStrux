---
id: TUI-73
title: Paddle subscription billing + webhook
status: done
phase: P5
module: platform
priority: P0
size: L
endpoints:
  - GET /billing/subscription
  - POST /billing/checkout
  - POST /billing/portal
  - POST /api/v1/webhooks/paddle
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-73 Paddle subscription billing + webhook

org_subscriptions table. Solo $9.90, Small $24.90; annual $99 and $249; round NZD, AUD and GBP prices (D-027). Webhook updates plan, limits, status.

Decisions: D-152 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
