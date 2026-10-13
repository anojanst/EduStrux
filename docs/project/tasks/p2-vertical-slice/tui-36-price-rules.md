---
id: TUI-36
title: Price rules engine (per term, per lesson, monthly, packs, free trial)
status: done
phase: P2
module: billing
priority: P0
size: L
endpoints:
  - GET|POST /price-rules
  - PATCH|DELETE /price-rules/{id}
branch: task/tui-36-price-rules
pr:
---

# TUI-36 Price rules engine (per term, per lesson, monthly, packs, free trial)

Per-subject pricing, integer minor units. Bundles (1/2/3+ subjects, grade bundles) moved to TUI-58 (D-078).

Decisions: D-076 (what a price is charged for), D-077 (packs and free trial), D-079 (default tax rate), D-080 to D-084 (rule shape, which price applies, who reaches rules, routes and in-use checks). The path parameter is `{priceRuleId}`. `loadPricing()` in the billing service prices enrolments for TUI-37.
