---
id: TUI-28
title: Academic years, terms and holidays
status: done
phase: P2
module: orgs
priority: P0
size: M
endpoints:
  - GET|POST /academic-years
  - PATCH /academic-years/{id}
  - GET|POST /terms
  - PATCH|DELETE /terms/{id}
  - GET|POST /holidays
  - DELETE /holidays/{id}
branch: task/tui-28-35-calendar-tax-rates
pr: 13
---

# TUI-28 Academic years, terms and holidays

Support rolling monthly as well as terms.

Built with TUI-35. Terms are optional per class; a class without one is billed monthly (D-036).
Academic years can't overlap or be deleted, and terms sit inside their year without overlapping
(D-037). Holidays are date ranges, org-wide or for one branch (D-038). Lists are in start-date
order (D-040). Deleting a term will need an "in use" check once classes (TUI-31) use terms.
