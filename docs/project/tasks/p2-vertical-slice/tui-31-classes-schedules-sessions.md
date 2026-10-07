---
id: TUI-31
title: Classes + weekly schedule + session generation
status: todo
phase: P2
module: classes
priority: P0
size: L
endpoints:
  - GET|POST /classes
  - GET|PATCH|DELETE /classes/{id}
  - PUT /classes/{id}/schedule
  - GET /sessions
  - GET /sessions/{id}
branch:
pr:
---

# TUI-31 Classes + weekly schedule + session generation

Recurrence rule → dated sessions, holidays skipped, local date/time + org tz (DST-safe, D-016). PUT schedule regenerates future sessions only.
