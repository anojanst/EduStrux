---
id: TUI-93
title: 'Price rules: every query reads the whole table'
status: todo
phase: P2
module: billing
priority: P1
size: S
endpoints:
  - GET|POST /price-rules
  - DELETE /classes/{id}
  - DELETE /courses/{id}
  - DELETE /tax-rates/{id}
branch:
pr:
---

# TUI-93 Price rules: every query reads the whole table

Every query on `price_rules` reads the whole table, across all centres. 13 of the statements the
test suite sends do this, from these endpoints:

- `DELETE /tax-rates/{id}`
- `DELETE /courses/{id}`
- `DELETE /classes/{id}`
- `GET /price-rules`
- `POST /price-rules`

Why: the table's only indexes are the two partial unique ones, `price_rules_org_target_term_uq`
and `price_rules_org_target_no_term_uq`. Each has a condition on `basis` in its `WHERE`, so
SQLite can use it only for a query that repeats that condition, and none does. The plans are
`SCAN price_rules`, found with `EXPLAIN QUERY PLAN` on the schema the migrations build.

The table is small today, so nothing is slow yet. It is the one table where a request reads other
centres' rows to answer its own, and the read grows with every centre added.

Not checked: the invoice jobs (TUI-37) read price rules too, but they run outside a request and
weren't counted.

Ideas, none decided:

- A plain index that starts with `org_id`, for example `(org_id, class_id, course_id)`.
