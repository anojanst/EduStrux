---
id: TUI-75
title: Super-admin console with logged impersonation
status: todo
phase: P5
module: platform
priority: P1
size: M
endpoints:
  - GET /api/v1/admin/orgs
  - GET|PATCH /api/v1/admin/orgs/{id}
  - POST /api/v1/admin/orgs/{id}/impersonate
branch:
pr:
---

# TUI-75 Super-admin console with logged impersonation

Outside org routes. Every access logged.
