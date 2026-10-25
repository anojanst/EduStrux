---
id: TUI-119
title: 'Invoices & payments UI: invoices list, invoice page, invoice runs, record payment, payments list'
status: done
phase: P7
module: web
priority: P0
size: L
endpoints: []
branch: task/tui-119-invoices-payments-ui
pr:
---

# TUI-119 Invoices & payments UI: invoices list, invoice page, invoice runs, record payment, payments list

Split out of TUI-40: the billing part of the staff vertical slice. Designed in Figma Make first, like TUI-109 and TUI-112.

- **Invoices list:** status chips, term/month and branch filters, totals, Load more.
- **Invoice page:** lines by student and class, discounts and tax, paid and balance, payments towards it; Issue, Void, Edit due date and note, Download PDF.
- **Invoice run:** generate a term's or a month's drafts, a progress card on the job, and the result (made, already invoiced, skipped with reasons).
- **Record payment:** from the top bar, the family page and the invoice page; allocate across the family's open invoices, oldest first.
- **Payments list:** method, reference, allocations, receipt PDF, delete a mistaken payment.

Uses the existing `/invoices`, `/payments`, `/terms/{id}/generate-invoices`, `/invoices/generate-monthly` and `/jobs/{id}` endpoints. Roles: owner, branch manager and front desk read and write (their branches); accountant reads all. Pricing, tax and discount settings screens are not in this task.
