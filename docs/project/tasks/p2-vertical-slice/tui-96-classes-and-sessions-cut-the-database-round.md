---
id: TUI-96
title: 'Classes and sessions: cut the database round trips'
status: done
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
branch: task/tui-89-94-95-96-97-round-trips
pr: 36
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

Target: the owner set the budget in D-102. Every endpoint gets about 3 trips in sequence: sign-in,
one read stage, one write. Calls in flight together count once, which is the `stages` number
every response reports (D-099). This replaced the proposal of about 200 ms, roughly 5 trips.

## Result

Every class and session endpoint is within the budget, 3 stages for a write and 2 for a read,
except a student's timetable (`GET /sessions?studentId`), which is 3. It waits for people's read
of one student, which is two stages deep, and drops to 2 when TUI-95 makes that read one.
`apps/api/test/classes-trips.test.ts` calls each endpoint once on its heaviest path and holds it
to these numbers, the reads as the owner, a teacher and a parent. How it is done, and the one
thing an answer no longer shows, are in D-108.

Counted on 2026-10-14 in the test suite, with the same request before and after. "Before" is the
branch of TUI-99, so sign-in is already one trip and working out a caller's reach costs none.
Before this task every call waited for the one before it, so trips and stages were the same
number, except on the timetable.

| Endpoint                                             | Before            | Trips after | Stages after |
| ---------------------------------------------------- | ----------------- | ----------- | ------------ |
| `POST /classes`, with a term, a room and a teacher   | 10                | 8           | 3            |
| `PUT /classes/{id}/schedule`                         | 10                | 8           | 3            |
| `PATCH /classes/{id}`: name, room, teacher and dates | 13                | 10          | 3            |
| `PATCH /classes/{id}`: capacity only                 | 5                 | 4           | 3            |
| `DELETE /classes/{id}`                               | 5                 | 5           | 3            |
| `GET /classes`, with its five filters                | 8                 | 8           | 2            |
| `GET /classes`, no filter                            | 3                 | 3           | 2            |
| `GET /classes/{id}`                                  | 3                 | 3           | 2            |
| `GET /sessions`, with five filters                   | 7                 | 7           | 2            |
| `GET /sessions`, no filter                           | 2                 | 2           | 2            |
| `GET /sessions/{id}`                                 | 2                 | 2           | 2            |
| `GET /sessions?studentId`                            | 6 trips, 5 stages | 5           | 3            |

What other modules read of a class or a session is one stage each. `getClass` was two (the
class, then its slots) and is one, with both calls sent together. `getSession`, `classLabels`,
`lessonDates`, `classDates`, `countClasses`, `classesBilledIn` and `sessionsClosedBy` were one
call each and still are.

How:

- All of a request's reads go to D1 together. The checks run afterwards on what came back, in
  the order they always ran in, so the same error is reported when several apply.
- A read that needs something from the class's row gets it as a query written into its own
  statement: the class's term, its course's lesson length, the holidays of its branch, the name
  check of a rename, and the weekly slots of a page of classes.
- A write answers with the row it returned, so the class isn't read again.
- A student's timetable is filtered inside the read of the sessions, by a query on the student's
  enrolments, where the enrolments were read first.

Left for later:

- What classes asks of the calendar, the curriculum and enrolment is in a `for-classes.ts` file
  in each of those modules, because other tasks were changing them at the same time. Fold each
  into its module's service and repository.
- `enrolment.spansOf` has no caller left.
- `classes.classDates` takes a class that was already read, so a caller that needs a class and
  its dates still waits twice. `calendar/for-classes.ts` reads a class's term by a query, which
  is what a one-stage version needs.
