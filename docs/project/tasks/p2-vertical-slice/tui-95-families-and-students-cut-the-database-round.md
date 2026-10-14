---
id: TUI-95
title: 'Families and students: cut the database round trips'
status: done
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
branch: task/tui-89-94-95-96-97-round-trips
pr: 39
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

Target: the owner set the budget in D-102. Every endpoint gets about 3 trips in sequence: sign-in,
one read stage, one write. Calls in flight together count once, which is the `stages` number
every response reports (D-099). This replaced the proposal of about 200 ms, roughly 5 trips.

## Result

Every families and students endpoint is within the budget: 3 stages for a write, 2 for a read.
`apps/api/test/people-trips.test.ts` calls each one once on its heaviest path, as the owner and,
for the reads, as a teacher and a parent too, and holds it to these numbers. No response, status
code, error order or audit row changed, and nothing about what a role can see.

Counted on 2026-10-14 in the test suite, as trips / stages, with the same request before and
after. "Before" is the branch of TUI-99, so sign-in is one trip and working out what a caller may
see costs none. The owner, a teacher and a parent cost the same on every read.

| Endpoint                        | Heaviest path                              | Before | After |
| ------------------------------- | ------------------------------------------ | ------ | ----- |
| `GET /families`                 | `?branchId`                                | 7 / 5  | 7 / 2 |
| `GET /families/{id}`            |                                            | 6 / 4  | 6 / 2 |
| `POST /families`                |                                            | 6 / 5  | 3 / 3 |
| `PATCH /families/{id}`          | name, branch and billing contact           | 10 / 8 | 8 / 3 |
| `DELETE /families/{id}`         |                                            | 4 / 4  | 4 / 3 |
| `POST /families/{id}/guardians` | the first guardian                         | 4 / 4  | 3 / 3 |
| `PATCH /guardians/{id}`         |                                            | 4 / 4  | 3 / 3 |
| `DELETE /guardians/{id}`        |                                            | 3 / 3  | 3 / 3 |
| `GET /students`                 | `?familyId&branchId&gradeLevelId`          | 8 / 7  | 7 / 2 |
| `GET /students/{id}`            |                                            | 4 / 3  | 4 / 2 |
| `POST /students`                | birth date, grade level and academic year  | 8 / 7  | 5 / 3 |
| `PATCH /students/{id}`          | name, birth date, grade level and its year | 9 / 8  | 6 / 3 |
| `DELETE /students/{id}`         |                                            | 4 / 4  | 4 / 3 |

What other modules call, counted the same way with no sign-in: `getStudent` went from 3 / 2 to
3 / 1 and `getFamily` from 5 / 3 to 5 / 1. `studentNames`, `familyLabels`, `familyIdsOfStudents`,
`countFamilies`, `countStudentsInGrade`, `studentIdsOfGuardian` and `familyIdsInBranches` were
already one call each.

How:

- A family or a student is read together with what it is shown with: guardians, students, grades
  and the academic years. Those reads find their rows by a query for the family, the student or
  the page the request's own read returns, with the caller's reach in it (D-104). So for a record
  outside the caller's reach nothing is read, and it costs what an id that doesn't exist costs.
- A write answers with the row its own statement returned and the rows read before it, so
  nothing is read back.
- The checks before a write (the family, the branch, the grade level, the academic year, the
  birth date) are sent together. They still run in the same order on what came back, so the same
  error is reported when more than one would refuse.
- A named academic year is checked against the years already read, not looked up again.
- `GET /students?gradeLevelId` with no `academicYearId` filters by the current year, which the
  page used to wait for. The calendar now gives the current year as a query for its id
  (`apps/api/src/modules/calendar/for-people.ts`). It is the rule of D-055 written a second time,
  in SQL. `apps/api/test/people.test.ts` holds it to the year a student's own `gradeLevelId`
  shows, in each case of the rule.

What it costs:

- A request now sends its reads before it knows whether it needs them. An empty page, a 404 and
  a stale `updatedAt` make more calls than before, in the same one stage: `GET /families` with no
  families went from 2 trips to 6, `GET /students` with no students from 2 to 4, a missing
  family from 2 to 6, a missing student from 2 to 4, and a stale `PATCH /students/{id}` from 2
  to 4.
- What a page shows of other tables is read by a query for the page, so the page's own
  conditions run again inside each of those statements. A teacher's page reads their whole reach
  each time (D-104), so it is read once per statement. Rows read weren't measured.

These are counts from the local test database. Nothing was measured on production.
