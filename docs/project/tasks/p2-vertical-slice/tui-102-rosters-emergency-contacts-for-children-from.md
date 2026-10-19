---
id: TUI-102
title: 'Rosters: emergency contacts for children from another branch'
status: done
phase: P2
module: attendance
priority: P1
size: M
endpoints:
  - GET /classes/{classId}/emergency-contacts
branch: task/tui-102-cross-branch-emergency-contacts
pr: 48
---

# TUI-102 Rosters: emergency contacts for children from another branch

Decided by the owner on 2026-10-14 (D-112). Built as `GET /classes/{classId}/emergency-contacts`, a call of its own, which the owner picked on 2026-10-19 (D-128).

- Staff limited to a class's branch see, for each child on that class's roster whose family belongs to another branch, the guardians marked as emergency contacts: name, relationship and phone. Read only; no email.
- The rest of the family record stays with the home branch.
- The emergency-contact flag stays on by default (D-054), so in practice every guardian shows unless staff untick it.
- Where the API carries the contacts: a call of its own per class, listing every child with an active enrolment in it (D-128).
