---
id: TUI-99
title: 'Reach as subqueries: what a caller may see costs no extra trip'
status: done
phase: P1
module: platform
priority: P1
size: M
endpoints: []
branch: task/tui-99-reach-subqueries
pr:
---

# TUI-99 Reach as subqueries: what a caller may see costs no extra trip

A teacher, a parent or staff limited to some branches pays one or two database trips before the
real read, only to work out what they may see. Each service's `reachOf` turns the role into a
filter, and several get that filter by asking another module for a list of ids, which is read on
its own. The owner makes none of these trips, so the same endpoint costs more for the roles that
use it most.

The budget is about 3 trips in sequence: sign-in, one read stage, one write (D-102). The module
tasks (TUI-89, TUI-94 to TUI-97) can't reach it while reach is read first, and five tasks each
rewriting those filters would write the who-can-see-what rules five times. So it is changed
once, here.

Where, in `apps/api/src/modules/`:

- `people/service.ts`: a teacher's reach is the students in the classes they teach. That read
  the teacher's classes, then the active enrolments in them. Two trips, one after the other.
- `enrolment/service.ts`: branch staff read every class and every student in their branches, a
  teacher their classes, a parent their children.
- `classes/service.ts`: a parent's reach is the classes their children are in. That read the
  children, then their active enrolments. Two trips, one after the other.
- `billing/service.ts`: branch staff read every family in their branches, a parent their
  families.

Counted with `res.db` in the test suite, as trips / stages, in a centre with two branches where
every role sees at least one row. A cell with nothing after it didn't change.

| Request              | Owner | Teacher     | Parent      | Staff of one branch |
| -------------------- | ----- | ----------- | ----------- | ------------------- |
| `GET /families`      | 6 / 4 | 8 / 6 → 6/4 | 6 / 4       | 6 / 4               |
| `GET /families/{id}` | 6 / 4 | 8 / 6 → 6/4 | 6 / 4       | 6 / 4               |
| `GET /students`      | 4 / 3 | 6 / 5 → 4/3 | 4 / 3       | 4 / 3               |
| `GET /students/{id}` | 4 / 3 | 6 / 5 → 4/3 | 4 / 3       | 4 / 3               |
| `GET /enrolments`    | 4 / 3 | 5 / 4 → 4/3 | 5 / 4 → 4/3 | 6 / 4 → 4/3         |
| `GET /classes`       | 3 / 3 | 3 / 3       | 5 / 5 → 3/3 | 3 / 3               |
| `GET /classes/{id}`  | 3 / 3 | 3 / 3       | 5 / 5 → 3/3 | 3 / 3               |
| `GET /sessions`      | 2 / 2 | 2 / 2       | 4 / 4 → 2/2 | 2 / 2               |
| `GET /sessions/{id}` | 2 / 2 | 2 / 2       | 4 / 4 → 2/2 | 2 / 2               |
| `GET /invoices`      | 6 / 4 | 403, 1 / 1  | 7 / 5 → 6/4 | 7 / 5 → 6/4         |
| `GET /invoices/{id}` | 6 / 4 | 403, 1 / 1  | 7 / 5 → 6/4 | 7 / 5 → 6/4         |

## Built (D-104)

- An id list to filter by is real ids or a query for them, under one type, `Ids`. A repository
  filters by it with `inIds` either way, and `inOrg` still writes a lookup SQLite goes to with no
  table statistics. `idsFrom` makes a query, and puts the org in it.
- Each reach list comes from the module that owns the rule, as a query: `classes.classesTaughtBy`
  and `classesInBranches`; `people.studentsOfGuardian`, `studentsInBranches`,
  `familiesOfGuardian` and `familiesInBranches`; `enrolment.studentsEnrolledIn`,
  `classesOfStudents`, `studentsTaughtBy` and `classesOfChildren`. The last two are built from
  the others.
- Every `reachOf` uses them and makes no database call. Each is a plain function now, not an
  async one, so a call can't be added to it unnoticed.
- Ids are taken to be few, and a statement goes to them. Everything in some branches is marked
  `wide`: the page is read in its own order and each row looked up in the query.
- The load-by-ids functions other modules call take a query too (`people.studentNames`,
  `familyLabels` and `familyIdsOfStudents`, `classes.classLabels` and `lessonDates`,
  `enrolment.enrolmentsToInvoice`). `firstIds` gives the ids on one page.
- A parent's families and students, a teacher's families, and a teacher's or parent's sessions
  are now read from their ids. They read the whole org before (D-100 had left the first three).
- `apps/api/test/query-plans.test.ts` holds the plan of every reach, at every level.
  `apps/api/test/reach-trips.test.ts` holds each role to the owner's trips, and checks each role
  sees their own records and not the neighbour's.

Left as it was:

- Attendance (TUI-89 owns it). A parent's roster still reads their children's ids first, so
  `GET /sessions/{id}/attendance` is 6 trips for a parent and 5 for everyone else. It was 8.
- Two functions still return real ids, for the callers that work on the ids:
  `people.studentIdsOfGuardian` (the attendance roster) and `people.familyIdsInBranches` (the
  `?branchId` filter on `GET /invoices`).
- Staff limited to a branch that holds a small share of the centre: their pages of enrolments
  and invoices are read in order and checked, so they read far past their own rows. Measured in
  D-104.
