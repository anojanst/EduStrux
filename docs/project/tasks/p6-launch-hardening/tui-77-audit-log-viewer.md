---
id: TUI-77
title: Audit log viewer
status: done
phase: P6
module: platform
priority: P1
size: S
endpoints:
  - GET /audit-log
branch: task/tui-77-audit-log-viewer
pr:
---

# TUI-77 Audit log viewer

On main from the initial scaffold (owner-only, cursor paging; happy path + other-org 404 tested). This task added the 400 tests for a bad `limit` (0, 201, non-numeric), 403 tests for every non-owner role (branch_manager, front_desk, teacher, parent, accountant), and an OpenAPI check for the path. Owner-only access is recorded as D-030.
