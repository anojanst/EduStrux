---
id: TUI-94
title: 'Enrolments: cut the database round trips'
status: todo
phase: P2
module: enrolment
priority: P1
size: M
endpoints:
  - GET|POST /enrolments
branch:
pr:
---

# TUI-94 Enrolments: cut the database round trips

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint           | Fewest | Typical | Most |
| ------------------ | ------ | ------- | ---- |
| `POST /enrolments` | 12     | 13      | 14   |
| `GET /enrolments`  | 3      | 7       | 12   |

The trips of the heaviest request to each:

- `POST /enrolments`, 14 trips: users → memberships + orgs → students + families → academic_years → student_grades → orgs → classes → class_schedules → orgs → terms → enrolments → count enrolments → write batch (insert audit_log, insert enrolments) → enrolments
- `GET /enrolments`, 12 trips: users → memberships + orgs → classes → enrolments → students + families → academic_years → student_grades → orgs → classes → enrolments → students → classes

What stands out:

- Enrolling a student reads the org twice, and reads the enrolment back after writing it.
- The student's grade costs three trips every time (`academic_years`, `student_grades`, `orgs`).
  The same three are in the people and billing endpoints (TUI-95).
- The heaviest `GET /enrolments` reads `classes` three times and `enrolments` twice: to work
  out what the caller may see, then for the list and its class names.

Three causes are shared and have their own tasks: the two trips of sign-in and membership before
every request (TUI-90), lookups by a list of ids that read the whole centre (TUI-91), and list
pages that read and sort the whole centre (TUI-92). What is listed here is on top of those.

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
