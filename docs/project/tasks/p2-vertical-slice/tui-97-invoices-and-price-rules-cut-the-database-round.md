---
id: TUI-97
title: 'Invoices and price rules: cut the database round trips'
status: todo
phase: P2
module: billing
priority: P1
size: M
endpoints:
  - GET /invoices
  - GET|PATCH /invoices/{id}
  - POST /invoices/{id}/issue
  - POST /invoices/{id}/void
  - POST /invoices/generate-monthly
  - GET|POST /price-rules
  - PATCH|DELETE /price-rules/{id}
  - GET|POST /tax-rates
  - PATCH|DELETE /tax-rates/{id}
  - POST /terms/{id}/generate-invoices
branch: task/tui-97-billing-round-trips
pr:
---

# TUI-97 Invoices and price rules: cut the database round trips

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint                             | Fewest | Typical | Most |
| ------------------------------------ | ------ | ------- | ---- |
| `GET /invoices`                      | 3      | 13      | 13   |
| `POST /invoices/{id}/issue`          | 4      | 9       | 11   |
| `POST /price-rules`                  | 6      | 7       | 9    |
| `POST /invoices/{id}/void`           | 9      | 9       | 9    |
| `PATCH /invoices/{id}`               | 7      | 9       | 9    |
| `GET /invoices/{id}`                 | 7      | 7       | 8    |
| `PATCH /price-rules/{id}`            | 3      | 6       | 6    |
| `POST /terms/{id}/generate-invoices` | 4      | 4       | 6    |
| `POST /tax-rates`                    | 5      | 5       | 5    |
| `PATCH /tax-rates/{id}`              | 3      | 5       | 5    |
| `DELETE /tax-rates/{id}`             | 5      | 5       | 5    |
| `GET /price-rules`                   | 3      | 3       | 5    |
| `DELETE /price-rules/{id}`           | 4      | 4       | 4    |
| `GET /tax-rates`                     | 3      | 3       | 3    |
| `POST /invoices/generate-monthly`    | 3      | 3       | 3    |

The trips of the heaviest request to each:

- `GET /invoices`, 13 trips: users → memberships + orgs → families → guardians → students → academic_years → student_grades → orgs → invoices → invoice_lines → families → students → classes
- `POST /invoices/{id}/issue`, 11 trips: users → memberships + orgs → insert idempotency_keys → invoices → write batch (insert audit_log, update invoices) → invoices → invoice_lines → families → students → classes → update idempotency_keys
- `POST /price-rules`, 9 trips: users → memberships + orgs → classes → class_schedules → tax_rates → orgs → price_rules → write batch (insert audit_log, insert price_rules) → price_rules
- `POST /invoices/{id}/void`, 9 trips: users → memberships + orgs → invoices → write batch (insert audit_log, update invoices, update invoice_lines) → invoices → invoice_lines → families → students → classes
- `PATCH /invoices/{id}`, 9 trips: users → memberships + orgs → invoices → write batch (insert audit_log, update invoices) → invoices → invoice_lines → families → students → classes

What stands out:

- Every invoice response is built with five reads: the invoice, its lines, then the families,
  students and classes named on it. Issuing, voiding and changing an invoice do the write and
  then all five.
- The heaviest `GET /invoices` makes 6 trips before it reads an invoice: it loads a family with
  its guardians, its students and their grades.
- `POST /invoices/{id}/issue` adds two trips for the idempotency key.

Price rules scanning the whole table is a separate task (TUI-93).

Three causes are shared and have their own tasks: the two trips of sign-in and membership before
every request (TUI-90), lookups by a list of ids that read the whole centre (TUI-91), and list
pages that read and sort the whole centre (TUI-92). What is listed here is on top of those.

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
