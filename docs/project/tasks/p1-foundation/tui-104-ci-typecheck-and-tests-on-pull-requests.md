---
id: TUI-104
title: 'CI: typecheck and tests on pull requests'
status: todo
phase: P1
module: infra
priority: P1
size: S
endpoints: []
branch:
pr:
---

# TUI-104 CI: typecheck and tests on pull requests

Decided by the owner on 2026-10-14 (D-117). Not built.

- Typecheck and tests run on every pull request, before a merge. The repo is public, so GitHub's runners cost nothing.
- Not required by the main ruleset: the owner chose checks that run, not checks that block.
- The deploy workflow's other four details stay as built (D-076).
