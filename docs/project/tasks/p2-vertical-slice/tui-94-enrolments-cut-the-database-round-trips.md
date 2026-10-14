---
id: TUI-94
title: 'Enrolments: cut the database round trips'
status: done
phase: P2
module: enrolment
priority: P1
size: M
endpoints:
  - GET|POST /enrolments
branch: task/tui-89-94-95-96-97-round-trips
pr: 39
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

Target: the owner set the budget in D-102. Every endpoint gets about 3 trips in sequence: sign-in,
one read stage, one write. Calls in flight together count once, which is the `stages` number
every response reports (D-099). This replaced the proposal of about 200 ms, roughly 5 trips.

## Result

Both endpoints now read in one stage of their own. `GET /enrolments` with no filter is within
the budget, at 2 stages. With a filter it is 3, and `POST /enrolments` is 4: each one over, and
each waiting on another task. Both send `people.getStudent` or `classes.getClass` in their read
stage, and that stage is as deep as the deeper of the two. On this branch each is two stages
deep: the student and then their grades, the class and then its weekly slots. TUI-95 makes the
first one stage and TUI-96 the second.

Counted on 2026-10-14 in the test suite, as trips / stages, with the same request before and
after. "Before" is the branch of TUI-99, so sign-in is one trip and working out what a caller may
see costs none. On the list, the owner, a teacher, a parent and staff limited to one branch cost
the same on every row. Enrolling costs the owner and staff limited to one branch the same; a
teacher and a parent can't. The last column was counted as the owner on a trial merge with the
branches of TUI-95 and TUI-96, which wasn't kept.

| Request                                | Before  | After | With TUI-95 and TUI-96 |
| -------------------------------------- | ------- | ----- | ---------------------- |
| `GET /enrolments`                      | 4 / 3   | 4 / 2 | 4 / 2                  |
| `GET /enrolments?studentId`            | 7 / 5   | 6 / 3 | 6 / 2                  |
| `GET /enrolments?classId`              | 6 / 5   | 5 / 3 | 5 / 2                  |
| `GET /enrolments?studentId&classId`    | 9 / 7   | 7 / 3 | 7 / 2                  |
| `POST /enrolments`, a term and a limit | 11 / 10 | 9 / 4 | 9 / 3                  |

- `?studentId` waits on TUI-95, `?classId` on TUI-96, and both filters together and `POST` on
  both.
- Enrolling into a class with no term and no limit made 9 trips in 8 stages, and now makes 9
  in 4. The term and the places are asked for whether or not the class has them, so its trips
  didn't fall.
- `apps/api/test/enrolment-trips.test.ts` calls each row once as each of those callers and holds
  it to the "After" numbers. It also measures how deep the two reads are and checks the read
  stage is exactly that deep, so it keeps passing, at the lower numbers, once those tasks merge.
- No response, status code, validation, audit row, capacity or already-enrolled rule changed,
  nor the error reported when several apply, nor what a role can see.

What other modules read of enrolments was one call each already and still is: `countEnrolments`,
`studentIdsExpected`, `spansOf` and `enrolmentsToInvoice`. The ones that give a query for ids
(`studentsEnrolledIn`, `classesOfStudents`, `studentsTaughtBy`, `classesOfChildren`) cost none.
Names, parameters and return shapes are unchanged.

How:

- The list checks the student and the class asked for while it reads the page, and reads the
  names of the students and classes on the page by a query for that page (D-104). The checks
  still run in the old order on what came back, so the same 404 is reported.
- Asked for one student, every row shows that student, so their name comes from the check and
  isn't read again. The same goes for one class. That is where the list's trips fell.
- Enrolling a student reads everything from the two ids in the request, together: the student,
  the class, the class's dates and the places taken.
  - The class's term is found through the class's id, not from the class once read
    (`apps/api/src/modules/classes/for-enrolment.ts`, which reads the term through
    `apps/api/src/modules/calendar/for-enrolment.ts`).
  - Whether the student is already enrolled and how many places are taken are one statement.
    The places depend on the start date, which isn't known until the class is read, so the
    class's active enrolments come back counted by their last day and are added up afterwards.
- The enrolment is answered from the row its own insert returned. Nothing is read back.
- The two files added to other modules are there only because those modules were being
  rewritten by other tasks at the same time. They are to be folded into each module's service
  and repository. TUI-96 adds the same read of a term's dates in `calendar/for-classes.ts`, so
  one of the two goes then.

What it costs:

- A request sends its reads before it knows whether it needs them. An empty list went from 2
  trips to 4, a missing student or class on the list from 2 to 4, and enrolling a missing
  student from 2 to 6. All are still within 3 stages. A refusal that came late got cheaper:
  already enrolled is 8 trips as before, and a full class 8 where it was 9.
- A student or class outside the caller's reach costs exactly what one that doesn't exist costs,
  on both endpoints. The test holds that. D-099 had it checked by hand, for the list only.
- The names on a page are read by a query for the page, so the page's own conditions run again
  inside each of those two statements. For staff limited to some branches the page is read in id
  order and each row looked up (D-104), and that now happens three times for a page with no
  filter, not once. Rows read weren't measured.
- Enrolling into a class with no limit used to read one row to see whether the student was
  already in it. It now reads the class's active enrolments, as a class with a limit always did.
- The names are read at the same moment as the page, not after it. An enrolment made in between
  can be on the page without them, so those are then read by id, in one more stage. The test
  makes that happen and checks the names.

These are counts from the local test database. Nothing was measured on production.

Shipped in PR #39 together with the other four module tasks (TUI-89, TUI-94, TUI-95, TUI-96,
TUI-97). On that combined code the paths above that waited on another task are within the budget,
and the trip tests hold them to it.
