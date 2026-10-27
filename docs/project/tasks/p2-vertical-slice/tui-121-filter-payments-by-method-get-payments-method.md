---
id: TUI-121
title: Filter payments by method (GET /payments?method=)
status: done
phase: P2
module: billing
priority: P2
size: S
endpoints: []
branch: task/tui-120-121-invoice-numbers-payment-filter
pr: 61
---

# TUI-121 Filter payments by method (GET /payments?method=)

Follow-up from TUI-119: the Payments screen's Method filter only covered the payments loaded so far. Add `method` to `PaymentQuery` and filter in the API, then use it in the web list.
