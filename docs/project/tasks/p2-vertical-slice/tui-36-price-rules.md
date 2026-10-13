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
pr: 25
---

# TUI-36 Price rules engine (per term, per lesson, monthly, packs, free trial)

Per-subject pricing, integer minor units. Bundles (1/2/3+ subjects, grade bundles) moved to TUI-58 (D-079).

Decisions: D-077 (what a price is charged for), D-078 (packs and free trial), D-080 (default tax rate), D-081 to D-085 (rule shape, which price applies, who reaches rules, routes and in-use checks). The path parameter is `{priceRuleId}`. `loadPricing()` in the billing service prices enrolments for TUI-37.
