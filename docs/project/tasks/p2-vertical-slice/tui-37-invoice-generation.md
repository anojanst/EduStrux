---
id: TUI-37
title: Generate term/monthly invoices (job)
status: todo
phase: P2
module: billing
priority: P0
size: L
endpoints:
  - POST /terms/{id}/generate-invoices
  - GET /invoices
  - GET|PATCH /invoices/{id}
  - POST /invoices/{id}/issue
  - POST /invoices/{id}/void
  - GET /jobs/{id}
branch:
pr:
---

# TUI-37 Generate term/monthly invoices (job)

202 + jobId via startJob(); the handler must be idempotent (D-017). Idempotency-Key. Pro-rata, tax, discounts. Status draft/issued/paid/part-paid/void. Unique bank reference per family.
