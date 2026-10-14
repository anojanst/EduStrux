---
id: TUI-105
title: 'Students and families: no staff notes for parents'
status: todo
phase: P2
module: people
priority: P1
size: S
endpoints:
  - GET /students
  - GET /students/{studentId}
  - GET /families
  - GET /families/{familyId}
branch:
pr:
---

# TUI-105 Students and families: no staff notes for parents

Decided by the owner on 2026-10-15 (D-126, TUI-39). Not built.

- A student's `notes` are for staff ("anything staff should know about the student"). Parents don't see them.
- The parent portal (TUI-39) already leaves them out. Today a parent still reads them through `GET /students` and `GET /families` (each family's `students`).
- Teachers and every other role keep seeing them.
- Whether the field is left out or sent as null for parents is for this task, as with `defaultPrice` in TUI-100.
- Check every response that carries a student, not only these routes.
