---
id: TUI-77
title: Audit log viewer
status: in-progress
phase: P6
module: platform
priority: P1
size: S
endpoints:
  - GET /audit-log
branch:
pr:
---

# TUI-77 Audit log viewer

On main from the initial scaffold (owner-only, cursor paging; happy path + other-org 404 + accountant 403 tested). Missing: 400 test (bad limit), 403 tests for branch_manager, front_desk, teacher, parent.
