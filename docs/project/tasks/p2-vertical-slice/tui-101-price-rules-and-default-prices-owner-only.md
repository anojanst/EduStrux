---
id: TUI-101
title: 'Price rules and default prices: owner-only outside branch classes'
status: done
phase: P2
module: billing
priority: P1
size: S
endpoints:
  - POST /price-rules
  - PATCH|DELETE /price-rules/{id}
  - POST /courses
  - PATCH /courses/{id}
branch: task/tui-100-105-role-visibility
pr:
---

# TUI-101 Price rules and default prices: owner-only outside branch classes

Decided by the owner on 2026-10-14 (D-111). Built with TUI-100 and TUI-105: a non-owner may resend a course's current price but not set a new one, and branch staff with no branch list are refused org-wide and course rules too (D-127).

- Only the owner writes org-wide and course-wide price rules. Branch managers and front desk write rules only for classes in their own branches, like every other branch-limited write; anything else is 403.
- Branch managers and front desk still create and change courses, but only the owner sets or changes a course's `defaultPrice`, because it comes before the org-wide rule (D-082).
