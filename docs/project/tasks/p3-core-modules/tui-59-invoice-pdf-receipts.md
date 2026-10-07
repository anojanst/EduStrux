---
id: TUI-59
title: Invoice PDF + payment receipts
status: todo
phase: P3
module: billing
priority: P0
size: M
endpoints:
  - GET /invoices/{id}/pdf
  - GET /payments/{id}/receipt
  - GET /portal/invoices/{id}/pdf
branch:
pr:
---

# TUI-59 Invoice PDF + payment receipts

Server-side with Cloudflare Browser Rendering (D-025). Shows tax number. D-015: PDF strings come from the en catalog keyed by id; numbers, money and dates via the shared formatting helpers.
