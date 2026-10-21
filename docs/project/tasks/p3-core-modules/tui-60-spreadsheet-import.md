---
id: TUI-60
title: Spreadsheet import with manual column mapping
status: done
phase: P3
module: platform
priority: P1
size: L
endpoints:
  - POST /imports
  - GET /imports/{id}
  - PATCH /imports/{id}
  - POST /imports/{id}/commit
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-60 Spreadsheet import with manual column mapping

Commit runs as a job. AI mapping is a paid add-on, not MVP. Kept in the MVP (D-022).

Decisions: D-146 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
