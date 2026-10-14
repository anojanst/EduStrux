---
id: TUI-103
title: 'Audit log: an update stores only the fields that changed'
status: todo
phase: P1
module: platform
priority: P1
size: M
endpoints: []
branch:
pr:
---

# TUI-103 Audit log: an update stores only the fields that changed

Decided by the owner on 2026-10-14 (D-113), answering option 1 of the audit-log growth note in TUI-79. Not built.

- An update's audit row stores only the fields that changed, in `before` and `after`, as attendance already does (D-075). One change in the shared write helper (`writeWithAudit`).
- Archiving old rows to R2 (option 3) waits until the database size needs it.
- Context: in a local test of 1,000 centres over a year (2026-10-13), the audit log was 4.6 GB of a 10.2 GB database.
