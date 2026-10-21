---
id: TUI-45
title: Year-end promotion (job)
status: done
phase: P3
module: people
priority: P1
size: M
endpoints:
  - POST /students/promote
branch: task/tui-43-82-remaining-mvp-api
pr: 51
---

# TUI-45 Year-end promotion (job)

Move everyone up a grade in new academic year, with exceptions. Runs as a job; the handler must be idempotent (D-017).

Decisions: D-143 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
