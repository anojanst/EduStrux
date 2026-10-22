---
id: TUI-55
title: Make-up policy, automatic credits and staff booking
status: done
phase: P3
module: attendance
priority: P0
size: L
endpoints:
  - GET|PUT /makeup-policy
  - GET /makeup-credits
  - POST /makeup-bookings
  - DELETE /makeup-bookings/{id}
  - GET /portal/makeup-credits
branch: task/tui-43-82-remaining-mvp-api
pr: 51
---

# TUI-55 Make-up policy, automatic credits and staff booking

Credit source, expiry, used-by. First-class workflow.

Decisions: D-139 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
