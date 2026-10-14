---
id: TUI-38
title: Record payments + allocations
status: done
phase: P2
module: billing
priority: P0
size: M
endpoints:
  - GET|POST /payments
  - DELETE /payments/{id}
branch: task/tui-38-payments
pr:
---

# TUI-38 Record payments + allocations

Cash/transfer/cheque, partial payments, allocate to invoices, update invoice status. Idempotency-Key.

Built as `GET|POST /payments` and `DELETE /payments/{paymentId}`. A payment's allocations add up
to its amount, and each invoice moves to `part_paid` or `paid` in the same write. Invoices gain
`paid` and `balance`. Decisions: D-118 to D-122.
