---
id: TUI-37
title: Generate term/monthly invoices (job)
status: done
phase: P2
module: billing
priority: P0
size: L
endpoints:
  - POST /terms/{termId}/generate-invoices
  - POST /invoices/generate-monthly
  - GET /invoices
  - GET|PATCH /invoices/{invoiceId}
  - POST /invoices/{invoiceId}/issue
  - POST /invoices/{invoiceId}/void
  - GET /jobs/{jobId}
branch: task/tui-37-invoice-generation
pr: 28
---

# TUI-37 Generate term/monthly invoices (job)

202 + jobId via startJob(); the handler must be idempotent (D-017). Idempotency-Key. Pro-rata, tax. Status draft/issued/part_paid/paid/void. Unique bank reference per family.

Prices come from `loadPricing()` in the billing service (TUI-36, D-082). It returns the price terms only: this task counts lessons for per-lesson prices, packs and free-trial lessons (D-078), does the pro-rata, applies the tax rate and copies the price onto the invoice line.

Built as:

- Owner decisions: pro-rata by lessons (D-086), packs used by scheduled lessons (D-087), one invoice per family per run reached through the family's home branch (D-088), and the monthly run at `POST /invoices/generate-monthly` (D-089).
- No discounts here: they wait for TUI-58. An enrolment with no price is skipped and reported (D-090).
- Recorded from the build, for the owner to confirm: what a run bills and the skip reasons (D-091), the pack balance (D-092), rounding and tax (D-093), once per enrolment and period (D-094), statuses, issuing and voiding (D-095), who reaches invoices (D-096), the family's bank reference (D-097), and the routes, tables and list (D-098).
- `GET /jobs/{jobId}` was already on `main` (TUI-66).
- `part_paid` and `paid` are set by payments (TUI-38). There is no invoice number yet; the PDF task (TUI-59) needs one.
