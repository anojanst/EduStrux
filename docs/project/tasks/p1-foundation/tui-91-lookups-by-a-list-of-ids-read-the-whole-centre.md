---
id: TUI-91
title: Lookups by a list of ids read the whole centre
status: todo
phase: P1
module: platform
priority: P1
size: M
endpoints: []
branch:
pr:
---

# TUI-91 Lookups by a list of ids read the whole centre

When a query asks for rows by a list of ids inside an org, SQLite reads every row the org has in
that table and then filters, instead of going to the ids. The cost grows with the centre, not
with the list.

Measured in TUI-89: one attendance write read 750 rows in a centre of 150 students and 3,750 in a
centre of 1,150. With table statistics (`ANALYZE`) the same write read 71, but production has
none. D1 counts and bills rows read.

Where: the `inOrg` and `inIds` helpers in `apps/api/src/db/scope.ts` are used together. With
`org_id = ?` next to `id in (select value from json_each(?))`, the planner picks an index that
starts with `org_id` and uses only that column. Found by taking the query plan of every statement
the test suite sends (329), on the schema the migrations build.

Statements that do this, and the endpoints that send them:

- students by a list of id. It picks `students_org_family_idx`. Sent by `GET /invoices`, `GET /enrolments`, `PUT /sessions/{id}/attendance`, `POST /invoices/{id}/issue`, `GET /sessions/{id}/attendance`, `POST /invoices/{id}/void`, `PATCH /invoices/{id}`, `GET /invoices/{id}`, `GET /sessions`, `GET /students/{id}`, `GET /families/{id}`.
- enrolments by a list of student_id. It picks `enrolments_org_class_idx`. Sent by `GET /enrolments`, `GET /sessions`, `GET /sessions/{id}/attendance`, `GET /classes`, `GET /classes/{id}`, `GET /sessions/{id}`.
- classes by a list of id. It picks `classes_org_course_term_branch_name_uq`. Sent by `GET /invoices`, `GET /enrolments`, `POST /invoices/{id}/issue`, `POST /invoices/{id}/void`, `PATCH /invoices/{id}`, `GET /invoices/{id}`.
- enrolments by a list of class_id. It picks `enrolments_org_student_idx`. Sent by `GET /enrolments`, `GET /sessions`, `GET /students`, `GET /families`, `GET /families/{id}`, `GET /students/{id}`.
- students by a list of family_id. It picks `students_org_name_idx`. Sent by `GET /invoices`, `PATCH /families/{id}`, `GET /families`, `GET /families/{id}`, `POST /families`.
- families by a list of id. It picks `families_org_branch_idx`. Sent by `GET /invoices`, `POST /invoices/{id}/issue`, `POST /invoices/{id}/void`, `PATCH /invoices/{id}`, `GET /invoices/{id}`.
- sessions, in an update, by a list of id. It picks `sessions_org_class_date_start_uq`. Sent by `PATCH /classes/{id}`, `PUT /classes/{id}/schedule`.
- attendance, in an update, by a list of id. It picks `attendance_org_student_idx`. Sent by `PUT /sessions/{id}/attendance`.

Two are writes: clearing attendance marks reads every attendance row of the org, and changing a
class or its schedule reads every session of the org.

Ideas, none decided:

- Change the helper so the planner uses the ids. In a test, writing `+org_id = ?` made it pick
  the primary key.
- Check each statement's plan in a test, so a new one can't slip back.

Also here, because it is the same kind of miss: `activeStudentIdsOn` in the enrolment repository
uses `SELECT DISTINCT`, which makes the planner read every enrolment of the org; without
`DISTINCT` it uses the class index (TUI-89).
