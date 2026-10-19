---
id: TUI-105
title: 'Students and families: no staff notes for parents'
status: done
phase: P2
module: people
priority: P1
size: S
endpoints:
  - GET /students
  - GET /students/{studentId}
  - GET /families
  - GET /families/{familyId}
branch: task/tui-100-105-role-visibility
pr: 47
---

# TUI-105 Students and families: no staff notes for parents

Decided by the owner on 2026-10-15 (D-126, TUI-39). Built with TUI-100 and TUI-101: parents get students with `notes` left out, not null (D-127).

- A student's `notes` are for staff ("anything staff should know about the student"). Parents don't see them.
- The parent portal (TUI-39) already leaves them out. Today a parent still reads them through `GET /students` and `GET /families` (each family's `students`).
- Teachers and every other role keep seeing them.
- Whether the field is left out or sent as null for parents is for this task, as with `defaultPrice` in TUI-100.
- Check every response that carries a student, not only these routes.
