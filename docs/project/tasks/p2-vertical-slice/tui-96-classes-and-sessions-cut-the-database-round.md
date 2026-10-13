---
id: TUI-96
title: 'Classes and sessions: cut the database round trips'
status: todo
phase: P2
module: classes
priority: P1
size: M
endpoints:
  - GET|POST /classes
  - GET|PATCH|DELETE /classes/{id}
  - PUT /classes/{id}/schedule
  - GET /sessions
  - GET /sessions/{id}
branch:
pr:
---

# TUI-96 Classes and sessions: cut the database round trips

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint                     | Fewest | Typical | Most |
| ---------------------------- | ------ | ------- | ---- |
| `PATCH /classes/{id}`        | 5      | 7       | 12   |
| `PUT /classes/{id}/schedule` | 10     | 12      | 12   |
| `POST /classes`              | 8      | 9       | 11   |
| `GET /sessions`              | 4      | 5       | 11   |
| `DELETE /classes/{id}`       | 6      | 6       | 6    |
| `GET /classes`               | 3      | 4       | 6    |
| `GET /classes/{id}`          | 4      | 4       | 6    |
| `GET /sessions/{id}`         | 4      | 4       | 6    |

The trips of the heaviest request to each:

- `PATCH /classes/{id}`, 12 trips: users → memberships + orgs → classes → terms → orgs → class_schedules → terms → holidays → sessions → write batch (insert audit_log, update classes, update sessions) → classes → class_schedules
- `PUT /classes/{id}/schedule`, 12 trips: users → memberships + orgs → classes → courses → class_schedules → orgs → terms → holidays → sessions → write batch (insert audit_log, update class_schedules, insert class_schedules, insert sessions, insert sessions) → classes → class_schedules
- `POST /classes`, 11 trips: users → memberships + orgs → courses → terms → branches → rooms → memberships → classes → write batch (insert audit_log, insert classes) → classes → class_schedules
- `GET /sessions`, 11 trips: users → memberships + orgs → classes → enrolments → students + families → academic_years → student_grades → orgs → enrolments → orgs → sessions + classes

What stands out:

- `PATCH /classes/{id}` and `PUT /classes/{id}/schedule` read the class and its schedule before
  the write and again after it. `PATCH` also reads the term twice.
- Creating a class checks the course, term, branch, room and teacher one trip at a time. They
  don't depend on each other.
- The heaviest `GET /sessions` makes 8 trips before it reads a session, and reads the org twice.

Three causes are shared and have their own tasks: the two trips of sign-in and membership before
every request (TUI-90), lookups by a list of ids that read the whole centre (TUI-91), and list
pages that read and sort the whole centre (TUI-92). What is listed here is on top of those.

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
