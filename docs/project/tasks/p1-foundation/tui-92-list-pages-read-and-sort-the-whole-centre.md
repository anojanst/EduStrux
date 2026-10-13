---
id: TUI-92
title: List pages read and sort the whole centre
status: todo
phase: P1
module: platform
priority: P1
size: M
endpoints:
  - GET /enrolments
  - GET /invoices
  - GET /classes
  - GET /courses
  - GET /branches
  - GET /subjects
  - GET /tax-rates
branch:
pr:
---

# TUI-92 List pages read and sort the whole centre

A list ordered by id has no index in that order, so each page reads every row the org has in the
table and sorts them before taking the page. The cursor (`id > ?`) doesn't help, for the same
reason.

Found by taking the query plan of every statement the test suite sends (329), on the schema the
migrations build, with no table statistics, as on production. These lists show a full read of the
org plus a sort (`USE TEMP B-TREE FOR ORDER BY`):

- `GET /enrolments`
- `GET /invoices`
- `GET /classes`
- `GET /courses`
- `GET /branches`
- `GET /subjects`
- `GET /tax-rates`

`GET /price-rules` is worse and has its own task (TUI-93). Enrolments and invoices are the ones
that grow: a centre adds hundreds of each every term. Branches, subjects and tax rates are a
handful of rows per centre, so there it costs nothing yet.

With a filter (`?classId`, `?studentId`, `?termId`, `?status`), the list reads the matching
rows through the filter's index and sorts only those. That is fine for a class or a student, and
large for `GET /invoices?status=`.

These lists already page along an index and need nothing: `GET /audit-log`, `GET /academic-years`, `GET /terms`, `GET /holidays`, `GET /sessions`, `GET /students`, `GET /families`.

Ideas, none decided:

- An index on `(org_id, id)` for each table that is paged by id.
- A test that fails when a list's plan contains a sort.
