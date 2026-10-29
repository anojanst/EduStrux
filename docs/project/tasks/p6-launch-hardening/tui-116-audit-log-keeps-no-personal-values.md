---
id: TUI-116
title: Audit log keeps no personal values
status: done
phase: P6
module: platform
priority: P0
size: S
endpoints: []
branch: task/tui-115-116-least-data
pr:
---

# TUI-116 Audit log keeps no personal values

D-171 (follows from the least-data rule; confirmed by the owner on 2026-10-26). Today the audit log's `before` and
`after` keep a second copy of every personal value that changed, for ever.

- For families, guardians, students, consents and lesson notes, a personal field in `before` or
  `after` is written as the field name with the value `"changed"`, not the value. Ids, statuses,
  dates and amounts are kept as now.
- One list of personal fields per entity, in `writeWithAudit`, so a field added later is covered
  by adding one word.
- A data migration scrubs the same fields in the rows already stored.
- Tests: a guardian email change writes `{ "email": "changed" }`; an old row is scrubbed.

Built with TUI-115 as D-187: `PERSONAL_AUDIT_FIELDS` in `apps/api/src/db/scope.ts`, keyed by the first word of the action. Enquiry and enrolment-request audit rows are covered too. Migration 0037 scrubs the rows already stored.
