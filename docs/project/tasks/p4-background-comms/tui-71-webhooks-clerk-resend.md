---
id: TUI-71
title: 'Webhooks: Clerk + Resend (signed, idempotent)'
status: done
phase: P4
module: platform
priority: P0
size: M
endpoints:
  - POST /api/v1/webhooks/clerk
  - POST /api/v1/webhooks/resend
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-71 Webhooks: Clerk + Resend (signed, idempotent)

Sync users; email delivery status.

Decisions: D-150 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
