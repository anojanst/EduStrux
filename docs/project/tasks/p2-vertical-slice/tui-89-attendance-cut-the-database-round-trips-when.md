---
id: TUI-89
title: 'Attendance: cut the database round trips when marking'
status: done
phase: P2
module: attendance
priority: P1
size: M
endpoints:
  - GET|PUT /sessions/{id}/attendance
branch: task/tui-89-94-95-96-97-round-trips
pr: 34
---

# TUI-89 Attendance: cut the database round trips when marking

Marking one student took about half a second on production. The goal was to bring a
single-student mark to roughly 200 ms at the median. The owner replaced that target with a
budget: about 3 database trips in sequence for every endpoint (D-102).

Measured on 2026-10-13, before any of the fixes, with one-off scripts that are not in the repo:

- Production (Cloudflare, Auckland edge, D1 in Oceania): 1,000 single-student `PUT`s, 8 at a
  time, took 72 s. 13.9 requests a second; 546 ms median, 682 ms p95, 777 ms p99, 363 ms fastest.
  All returned 200 and all 1,000 marks read back.
- Local (`wrangler dev`): 25,000 single-student `PUT`s, 8 at a time, took 437 s. 57 requests a
  second; 135 ms median queued, 21 ms one at a time. The same 25,000 write batches replayed
  straight into the database file took 2.5 s, so the write itself is not the slow part.

Why: one `PUT` makes 11 D1 calls, and on Cloudflare each is a network round trip (about 40 ms
each, estimated from the totals, not measured). In order: the user, the membership, the session
with its class, the org, the org again, the students expected, the marks, the write batch, the
students expected again, the marks again, the students' names.

Two of those reads scan the whole centre instead of the class. D1's own counters for one
single-student write: 750 rows read and 8 written in a centre of 150 students and 288
enrolments; 3,750 rows read in a centre of 1,150 students.

- `activeStudentIdsOn` (enrolment repository): `SELECT DISTINCT` makes SQLite pick
  `enrolments_org_student_idx` and read every enrolment in the org. Without `DISTINCT` it picks
  `enrolments_org_class_idx`.
- `studentNames` (people repository): `inOrg` with `inIds` makes it pick
  `students_org_family_idx` and read every student in the org, not the primary key. Other lookups
  that pair `inOrg` with `inIds` may do the same.

With table statistics (`ANALYZE`) both use the right index and the same write reads 71 rows, but
production has none.

What was built, over four tasks:

- TUI-90 (D-099): the user, the membership and the org come in one call, and the org isn't read
  again. 11 calls became 8.
- TUI-91 (D-100): the two lookups above go to the class's index and to the primary key. Who is
  expected at a lesson went from 601 rows read to 31 in a local centre of 300 students.
- TUI-99 (D-104): what a caller may see is worked out inside the read, with no trip of its own.
- This task (D-105): the session, the marks, the class's enrolments and the names are read in
  one stage, sent together and not as a D1 batch. A mark is answered from what was read and what
  the write returned, so the roster and the marks aren't read again after the write.
- Cloudflare Smart Placement: the owner decided against it for now (D-102).

Counted in the test suite, as calls / stages (`apps/api/test/attendance-trips.test.ts` holds
them). "Before" is this task's starting point, after TUI-90, TUI-91 and TUI-99:

| Request                                    | Before | Now   |
| ------------------------------------------ | ------ | ----- |
| `GET`, as the owner or the class's teacher | 5 / 4  | 6 / 2 |
| `GET`, as a parent                         | 6 / 5  | 5 / 2 |
| `PUT`, one student or the whole class      | 8 / 6  | 7 / 3 |

A single-student `PUT` now makes 7 calls and waits for 3 of them in a row:

1. Sign-in: the user, the membership and the org.
2. Sent together: the session with its class, the marks, the class's active enrolments with
   their dates, the names of the students enrolled in the class, and the names of the students
   marked.
3. The write batch, which returns the marks it set.

What it costs: the names are two calls where they were one, so a `GET` makes one call more than
before for everyone but a parent, and more rows are read. On a local D1, for a class of 30 with
everyone marked: 248 rows for a `GET` (153 before) and 248 for the reads of a `PUT` (214
before). They follow the class, not the centre.

Not measured on production after the change. Every response says what it cost in its
`Server-Timing` header, so a deployed `PUT` can be checked with `curl -i`.

Left for later:

- `apps/api/src/modules/enrolment/for-attendance.ts` and
  `apps/api/src/modules/classes/for-attendance.ts` hold what attendance asks of those modules.
  They are to be folded into each module's service and repository once TUI-94 and TUI-96 have
  merged. `enrolment.studentIdsExpected` and `people.studentIdsOfGuardian` have no caller any
  more and can go with it.
- The names in one call, which would take `GET` to 5 calls and `PUT` to 6. It needs a query for
  ids from either of two tables, which the id helper doesn't have (D-105).

Left in production by the test: the org "Load test 2026-10-13 09:05 (safe to delete)",
`org_01m4t84ydweta7j49mvxm0zyzk`, with 12 students, 6 classes, 84 sessions and 1,000 marks.

Added by the audit of every endpoint on 2026-10-13: `GET /sessions/{id}/attendance` makes 7 to
10 database trips. The causes shared with other endpoints have their own tasks: the two trips of
sign-in and membership before every request (TUI-90) and lookups by a list of ids that read the
whole centre (TUI-91).
