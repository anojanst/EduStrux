---
id: TUI-93
title: 'Price rules: every query reads the whole table'
status: done
phase: P2
module: billing
priority: P1
size: S
endpoints:
  - GET|POST /price-rules
  - DELETE /classes/{id}
  - DELETE /courses/{id}
  - DELETE /tax-rates/{id}
branch: task/tui-91-93-query-plans
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

Built as:

- A unique index on `(org_id, id)`, the same one every list paged by id has (D-101). Every
  statement now reads the org's own rules, and `GET /price-rules` reads a page in order.
- No index on class or course: an org has tens of rules, and the in-use checks and the check
  for a rule already on a target run on rare writes.
- The invoice run was checked. It reads every rule of the org once (`allPriceRules`), which was
  a scan of the whole table and now goes through the new index. Its other lookups by a list of
  ids are covered by TUI-91.
- Migration `0014_price_rules_org_index`.
- `apps/api/test/query-plans.test.ts` fails when a price-rule statement scans the table.
