---
id: TUI-98
title: 'Setup endpoints: cut the database round trips'
status: todo
phase: P2
module: orgs
priority: P2
size: M
endpoints:
  - GET|POST /academic-years
  - PATCH /academic-years/{id}
  - GET|POST /branches
  - PATCH|DELETE /branches/{id}
  - GET|POST /branches/{id}/rooms
  - GET|POST /courses
  - PATCH|DELETE /courses/{id}
  - GET|POST /grade-levels
  - PATCH|DELETE /grade-levels/{id}
  - PUT /grade-levels/order
  - GET|POST /holidays
  - DELETE /holidays/{id}
  - GET|PATCH /orgs/{id}
  - PATCH|DELETE /rooms/{id}
  - GET|POST /subjects
  - PATCH|DELETE /subjects/{id}
  - GET|POST /terms
  - PATCH|DELETE /terms/{id}
branch:
pr:
---

# TUI-98 Setup endpoints: cut the database round trips

The setup endpoints: the org, branches, rooms, the calendar, grade levels, subjects and courses.
Only the owner writes most of them, and rarely, so this is the lowest of the round-trip tasks.

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint                     | Fewest | Typical | Most |
| ---------------------------- | ------ | ------- | ---- |
| `DELETE /branches/{id}`      | 10     | 10      | 10   |
| `PATCH /academic-years/{id}` | 3      | 7       | 8    |
| `POST /courses`              | 7      | 7       | 8    |
| `POST /terms`                | 7      | 7       | 7    |
| `PATCH /terms/{id}`          | 6      | 6       | 7    |
| `POST /holidays`             | 6      | 6       | 7    |
| `PATCH /courses/{id}`        | 3      | 6       | 7    |
| `POST /branches`             | 6      | 6       | 6    |
| `PATCH /branches/{id}`       | 3      | 6       | 6    |
| `POST /branches/{id}/rooms`  | 6      | 6       | 6    |
| `PATCH /orgs/{id}`           | 3      | 5       | 6    |
| `PATCH /rooms/{id}`          | 5      | 5       | 6    |
| `POST /academic-years`       | 6      | 6       | 6    |
| `POST /grade-levels`         | 6      | 6       | 6    |
| `PATCH /grade-levels/{id}`   | 6      | 6       | 6    |
| `DELETE /grade-levels/{id}`  | 6      | 6       | 6    |
| `PATCH /subjects/{id}`       | 3      | 6       | 6    |
| `DELETE /courses/{id}`       | 6      | 6       | 6    |

The other 15 setup endpoints make 3 to 5 trips.

The trips of the heaviest requests:

- `DELETE /branches/{id}`, 10 trips: users → memberships + orgs → branches → count branches → count rooms → count classes → count families → count holidays → count memberships → write batch (insert audit_log, update branches)
- `PATCH /academic-years/{id}`, 8 trips: users → memberships + orgs → academic_years → academic_years → terms → academic_years → write batch (insert audit_log, update academic_years) → academic_years
- `POST /courses`, 8 trips: users → memberships + orgs → subjects → grade_levels → orgs → courses → write batch (insert audit_log, insert courses) → courses

What stands out:

- Deleting a branch runs six "is it in use" counts, one trip each. They don't depend on each
  other.
- A `PATCH` reads the record, writes it, and reads it again.
- Creating a term, a holiday or a course takes 3 or 4 lookups before the write, then reads the
  new row back.

Three causes are shared and have their own tasks: the two trips of sign-in and membership before
every request (TUI-90), lookups by a list of ids that read the whole centre (TUI-91), and list
pages that read and sort the whole centre (TUI-92). What is listed here is on top of those.

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
