---
id: TUI-54
title: Absence notices (staff + parent)
status: done
phase: P3
module: attendance
priority: P0
size: S
endpoints:
  - GET|POST /absence-notices
  - POST /portal/absence-notices
branch: task/tui-54-56-absences-lesson-notes
pr:
---

# TUI-54 Absence notices (staff + parent)

Built (D-129). A notice covers one child from a date to a date, both included. It flags the child on the roster of every lesson in those dates and marks nothing: staff still set the status. Staff record notices with `POST /absence-notices`, parents with `POST /portal/absence-notices`, and `GET /absence-notices` lists them. The owner chose these rules on 2026-10-19.

Not built: telling staff when a parent reports an absence (TUI-70), and editing or withdrawing a notice.
