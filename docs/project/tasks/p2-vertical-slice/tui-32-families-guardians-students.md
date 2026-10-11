---
id: TUI-32
title: Families, guardians and students
status: done
phase: P2
module: people
priority: P0
size: M
endpoints:
  - GET|POST /families
  - GET|PATCH|DELETE /families/{id}
  - POST /families/{id}/guardians
  - PATCH|DELETE /guardians/{id}
  - GET|POST /students
  - GET|PATCH|DELETE /students/{id}
branch: task/tui-32-families-guardians-students
pr: 17
---

# TUI-32 Families, guardians and students

Billing contact, preferred channel, language, emergency contacts, consents. student_grades per academic year.

Built: path parameters are `{familyId}`, `{guardianId}` and `{studentId}`. A family has a home
branch. Emergency contacts are guardians with a flag, and the first guardian is the billing
contact. A student has one grade level per academic year. Consents were left to TUI-79. A grade
level in use by a student, and a family's home branch, can't be deleted.

Decisions: D-051 (a family has a home branch), D-052 (no consent fields yet), D-053 (who reaches
families and students), D-054 (guardians and the billing contact), D-055 (students, grades and
the current academic year), D-056 (normalised names and name-order lists), D-057 (family shape,
deletes, in-use checks).
