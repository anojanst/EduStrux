---
id: TUI-39
title: 'Parent portal: children, timetable, invoices'
status: done
phase: P2
module: portal
priority: P0
size: M
endpoints:
  - GET /portal/children
  - GET /portal/sessions
  - GET /portal/invoices
branch: task/tui-39-parent-portal
pr: 46
---

# TUI-39 Parent portal: children, timetable, invoices

Mobile web, no install. Parent sees own family only. Parents sign in through Clerk (D-021).

Built in TUI-39 (D-126): `GET /portal/children`, `GET /portal/sessions` and `GET /portal/invoices`,
for the parent role only. Staff notes are left out of the portal; TUI-105 hides them from parents
on the student and family routes too. The PDF (TUI-59), absence notices (TUI-54) and make-up
credits (TUI-55) are their own tasks.
