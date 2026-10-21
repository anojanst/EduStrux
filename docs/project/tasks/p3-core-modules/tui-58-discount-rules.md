---
id: TUI-58
title: Discount rules (sibling, multi-class, early-bird, scholarship, manual)
status: done
phase: P3
module: billing
priority: P0
size: M
endpoints:
  - GET|POST /discount-rules
  - PATCH|DELETE /discount-rules/{id}
branch: task/tui-43-82-remaining-mvp-api
pr: 51
---

# TUI-58 Discount rules (sibling, multi-class, early-bird, scholarship, manual)

Also builds bundles (price by number of subjects 1/2/3+, grade bundles like "Year 10 core"), moved here from TUI-36: an amount off or a fixed bundle price, and a bundle and a multi-class discount can't both apply (D-079).

Decisions: D-140 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
