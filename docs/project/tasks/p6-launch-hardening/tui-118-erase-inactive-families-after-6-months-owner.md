---
id: TUI-118
title: Erase inactive families after 6 months; owner sets money-record retention
status: done
phase: P6
module: platform
priority: P0
size: M
endpoints:
  - PATCH /orgs/{id}
branch: task/tui-118-auto-erase-retention
pr: 78
---

# TUI-118 Erase inactive families after 6 months; owner sets money-record retention

D-171, stated by the owner.

**Automatic erase.** A family is erased 6 months after it goes inactive: no running enrolments,
nothing owed, and no lesson, invoice or payment in the last 6 months. Same erase as
`POST /families/{id}/erase` (D-155), run by the daily cron, one `family.erased` audit row each
with `auto: true`. The 6 months is fixed, not a setting.

**Financial records.** Invoices and payments outlive the erase because tax law makes centres
keep them. The org owner sets how many years they're kept (`orgs.financial_retention_years`,
1–10, through `PATCH /orgs/{id}`, owner only). There's no country default: until the owner sets
it, nothing financial is deleted. Once the period has passed since an invoice's period end, an
erased family's invoices, lines, payments and allocations are deleted, and the family row with
them.

- Settings screen gets the field, with a line saying it depends on the centre's local tax law.
- Tests: the inactive rule (each condition on its own keeps the family), the retention field
  (owner only, 403 for others, 400 outside 1–10), deletion after the period, and nothing
  deleted while it's unset.
