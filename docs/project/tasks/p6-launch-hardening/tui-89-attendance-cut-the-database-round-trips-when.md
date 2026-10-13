---
id: TUI-89
title: 'Attendance: cut the database round trips when marking'
status: todo
phase: P6
module: attendance
priority: P1
size: M
endpoints:
  - PUT /sessions/{id}/attendance
branch:
pr:
---

# TUI-89 Attendance: cut the database round trips when marking

Marking one student takes about half a second on production. The goal is to bring a
single-student mark to roughly 200 ms at the median (a proposed target, for the owner to confirm).

Measured on 2026-10-13 with one-off scripts that are not in the repo:

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

Ideas, none decided:

- Load the org once, and build the response from what is already loaded instead of reading the
  roster and marks again after the write.
- Send the reads that don't depend on each other as one D1 batch.
- Make the two lookups above use the class index and the primary key.
- Cloudflare Smart Placement, which runs the Worker next to D1. This is a config change and a
  design decision for the owner, separate from the code.

Left in production by the test: the org "Load test 2026-10-13 09:05 (safe to delete)",
`org_01m4t84ydweta7j49mvxm0zyzk`, with 12 students, 6 classes, 84 sessions and 1,000 marks.
