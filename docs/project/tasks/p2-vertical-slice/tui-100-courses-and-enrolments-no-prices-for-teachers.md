---
id: TUI-100
title: 'Courses and enrolments: no prices for teachers and parents'
status: done
phase: P2
module: curriculum
priority: P1
size: S
endpoints:
  - GET /courses
  - GET /enrolments
branch: task/tui-100-105-role-visibility
pr:
---

# TUI-100 Courses and enrolments: no prices for teachers and parents

Decided by the owner on 2026-10-14 (D-110). Built with TUI-101 and TUI-105: a field a role may not see is left out, not sent as null (D-127).

- Teachers and parents read courses without `defaultPrice`. The owner, branch managers, front desk and accountants still see it.
- Teachers get no enrolment's `priceOverride` either, so they see no prices of any kind. Parents keep seeing their own children's prices.
- Check every response that carries a course or an enrolment, not only these two lists.
