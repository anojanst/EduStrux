---
id: TUI-32
title: Families, guardians and students
status: todo
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
branch:
pr:
---

# TUI-32 Families, guardians and students

Billing contact, preferred channel, language, emergency contacts, consents. student_grades per academic year.
