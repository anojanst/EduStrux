---
id: TUI-26
title: 'Onboarding: create org + current user'
status: done
phase: P2
module: orgs
priority: P0
size: M
endpoints:
  - GET /api/v1/me
  - POST /api/v1/orgs
  - GET /api/v1/orgs/{orgId}
  - PATCH /api/v1/orgs/{orgId}
branch:
pr:
---

# TUI-26 Onboarding: create org + current user

14-day trial, creator = owner. Branding logo upload waits for R2 files.
