---
id: TUI-114
title: Decide the least-data rule
status: done
phase: P0
module: decisions
priority: P0
size: S
endpoints: []
branch: docs/tui-114-least-data
pr: 59
---

# TUI-114 Decide the least-data rule

Decided by the owner on 2026-10-25 (D-171): EduStrux stores only the data the product can't work
without. "Good to have" is not a reason to keep a field. Most records are about children, and
any stored field is a liability once a system is breached.

The owner's answers: drop all six fields put forward (student date of birth, student notes,
family address, guardian relationship, guardian language, free-text absence reason), keep lesson
notes, erase an inactive family automatically after 6 months, and let the org owner set how long
financial records are kept.

Built by TUI-115 to TUI-118.
