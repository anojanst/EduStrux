---
id: TUI-125
title: Staff Home dashboard
status: done
phase: P7
module: web
priority: P0
size: M
endpoints: []
branch: task/tui-125-staff-home-dashboard
pr: 68
---

# TUI-125 Staff Home dashboard

Split from TUI-40. The staff Home (ui-design.md §9) for the owner, branch managers, front desk and
accountants: money cards (or the centre's counts for front desk), today's lessons with quick
attendance, Needs attention, quick actions, and Getting started for a new centre (D-179).

Left out: recent activity, which needs a feed endpoint (`GET /audit-log` is owner only and has
ids, not names).
