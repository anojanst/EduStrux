---
id: TUI-38
title: Record payments + allocations
status: todo
phase: P2
module: billing
priority: P0
size: M
endpoints:
  - GET|POST /payments
  - DELETE /payments/{id}
branch:
pr:
---

# TUI-38 Record payments + allocations

Cash/transfer/cheque, partial payments, allocate to invoices, update invoice status. Idempotency-Key.
