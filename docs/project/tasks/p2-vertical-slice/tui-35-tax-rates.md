---
id: TUI-35
title: Tax rates settings
status: done
phase: P2
module: billing
priority: P0
size: S
endpoints:
  - GET|POST /tax-rates
  - PATCH|DELETE /tax-rates/{id}
branch: task/tui-28-35-calendar-tax-rates
pr: 13
---

# TUI-35 Tax rates settings

Zero or more named rates, inclusive/exclusive, tax number on invoices. No tax is valid.

Built with TUI-28. `percent` is a decimal string ("8.875"), stored as integer thousandths of a
percent; every role reads, only the owner writes; the tax number is the org's `taxNumber`
(D-039). Deleting a rate will need an "in use" check once price rules (TUI-36) use rates.
