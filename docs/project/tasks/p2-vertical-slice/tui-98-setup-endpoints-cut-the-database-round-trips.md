---
id: TUI-98
title: 'Setup endpoints: cut the database round trips'
status: done
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
branch: task/tui-98-setup-round-trips
pr: 32
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

Target: the owner set the budget in D-102. Every endpoint gets about 3 trips in sequence: sign-in,
one read stage, one write. Calls in flight together count once, which is the `stages` number
every response reports (D-099). This replaced the proposal of about 200 ms, roughly 5 trips.

## Result

Every setup endpoint is within the budget: 3 stages for a write, 2 for a read.
`apps/api/test/setup-trips.test.ts` calls each one once on its heaviest path and holds it to
these numbers. No response, status code, error order or audit row changed.

Counted on 2026-10-14 in the test suite, with the same request before and after. "Before" is
`main` after TUI-90, so sign-in is already one trip, not the two the table above counted. Before
this task every call waited for the one before it, so trips and stages were the same number.

| Endpoint                     | Before | Trips after | Stages after |
| ---------------------------- | ------ | ----------- | ------------ |
| `GET /orgs/{id}`             | 1      | 1           | 1            |
| `PATCH /orgs/{id}`           | 4      | 4           | 3            |
| `GET /branches`              | 2      | 2           | 2            |
| `POST /branches`             | 4      | 3           | 3            |
| `PATCH /branches/{id}`       | 5      | 4           | 3            |
| `DELETE /branches/{id}`      | 9      | 9           | 3            |
| `GET /branches/{id}/rooms`   | 3      | 3           | 2            |
| `POST /branches/{id}/rooms`  | 5      | 4           | 3            |
| `PATCH /rooms/{id}`          | 5      | 4           | 3            |
| `DELETE /rooms/{id}`         | 4      | 4           | 3            |
| `GET /academic-years`        | 2      | 2           | 2            |
| `POST /academic-years`       | 5      | 4           | 3            |
| `PATCH /academic-years/{id}` | 7      | 6           | 3            |
| `GET /terms`                 | 3      | 3           | 2            |
| `POST /terms`                | 6      | 5           | 3            |
| `PATCH /terms/{id}`          | 7      | 5           | 3            |
| `DELETE /terms/{id}`         | 4      | 4           | 3            |
| `GET /holidays`              | 3      | 3           | 2            |
| `POST /holidays`             | 5      | 4           | 3            |
| `DELETE /holidays/{id}`      | 3      | 3           | 3            |
| `GET /grade-levels`          | 2      | 2           | 2            |
| `POST /grade-levels`         | 5      | 4           | 3            |
| `PATCH /grade-levels/{id}`   | 5      | 4           | 3            |
| `DELETE /grade-levels/{id}`  | 5      | 5           | 3            |
| `PUT /grade-levels/order`    | 4      | 3           | 3            |
| `GET /subjects`              | 2      | 2           | 2            |
| `POST /subjects`             | 4      | 3           | 3            |
| `PATCH /subjects/{id}`       | 5      | 4           | 3            |
| `DELETE /subjects/{id}`      | 4      | 4           | 3            |
| `GET /courses`               | 4      | 4           | 2            |
| `POST /courses`              | 6      | 5           | 3            |
| `PATCH /courses/{id}`        | 5      | 4           | 3            |
| `DELETE /courses/{id}`       | 5      | 5           | 3            |

How:

- A write answers with the row its own statement returned, so nothing is read back.
- Reads that don't need each other's answer are sent together: the checks before a create, the
  "is it in use" counts before a delete, the name check and the row for the `updatedAt` check.
- A check that needs something from the row being changed reads it inside its own statement, by
  joining that row to the rows it is checked against. That covers a room's branch, a term's year,
  a course's subject, grade level and unsent label, and the date a `PATCH` of a year or a term
  doesn't send. So it goes out with the read of the row, not after it.
- The checks still run in the same order on what came back, so the same error is reported when
  more than one would refuse.

These are counts from the local test database. Nothing was measured on production.
