---
id: TUI-75
title: Super-admin console with logged impersonation
status: done
phase: P5
module: platform
priority: P1
size: M
endpoints:
  - GET /api/v1/admin/orgs
  - GET|PATCH /api/v1/admin/orgs/{id}
  - POST /api/v1/admin/orgs/{id}/impersonate
branch: task/tui-43-82-remaining-mvp-api
pr: 51
---

# TUI-75 Super-admin console with logged impersonation

Outside org routes. Every access logged.

Decisions: D-154 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
