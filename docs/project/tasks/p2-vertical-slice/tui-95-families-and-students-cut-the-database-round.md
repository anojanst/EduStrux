---
id: TUI-95
title: 'Families and students: cut the database round trips'
status: todo
phase: P2
module: people
priority: P1
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

# TUI-95 Families and students: cut the database round trips

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint                        | Fewest | Typical | Most |
| ------------------------------- | ------ | ------- | ---- |
| `POST /students`                | 8      | 8       | 12   |
| `PATCH /students/{id}`          | 7      | 10      | 12   |
| `PATCH /families/{id}`          | 6      | 8       | 11   |
| `GET /students`                 | 3      | 6       | 10   |
| `GET /families`                 | 3      | 5       | 10   |
| `GET /families/{id}`            | 5      | 8       | 10   |
| `GET /students/{id}`            | 6      | 6       | 8    |
| `POST /families`                | 7      | 7       | 7    |
| `POST /families/{id}/guardians` | 5      | 5       | 5    |
| `DELETE /students/{id}`         | 5      | 5       | 5    |
| `DELETE /families/{id}`         | 5      | 5       | 5    |
| `PATCH /guardians/{id}`         | 3      | 5       | 5    |
| `DELETE /guardians/{id}`        | 4      | 4       | 4    |

The trips of the heaviest request to each:

- `POST /students`, 12 trips: users → memberships + orgs → families → orgs → grade_levels → academic_years → orgs → write batch (insert audit_log, insert students, insert student_grades) → students + families → academic_years → student_grades → orgs
- `PATCH /students/{id}`, 12 trips: users → memberships + orgs → students + families → grade_levels → academic_years → orgs → student_grades → write batch (insert audit_log, update students, insert student_grades) → students + families → academic_years → student_grades → orgs
- `PATCH /families/{id}`, 11 trips: users → memberships + orgs → families → branches → write batch (insert audit_log, update families) → families → guardians → students → academic_years → student_grades → orgs
- `GET /students`, 10 trips: users → memberships + orgs → branches → grade_levels → academic_years → orgs → students + families + student_grades → academic_years → student_grades → orgs
- `GET /families`, 10 trips: users → memberships + orgs → classes → enrolments → families + students → guardians → students → academic_years → student_grades → orgs
- `GET /families/{id}`, 10 trips: users → memberships + orgs → classes → enrolments → families + students → guardians → students → academic_years → student_grades → orgs

What stands out:

- Every response that carries a student ends with the same three trips to work out the grade:
  `academic_years`, `student_grades`, `orgs`. Enrolments, sessions and invoices pay them too.
- A write reads the record again afterwards to build the response: 4 trips after
  `POST /students` and `PATCH /students/{id}`, 6 after `PATCH /families/{id}`.
- `POST /students` reads the org three times and the academic years twice.
- `GET /families` and `GET /families/{id}` read `classes` and `enrolments` first for a teacher,
  to work out which families they may see.

Three causes are shared and have their own tasks: the two trips of sign-in and membership before
every request (TUI-90), lookups by a list of ids that read the whole centre (TUI-91), and list
pages that read and sort the whole centre (TUI-92). What is listed here is on top of those.

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
