---
id: TUI-64
title: Onboarding wizard (full) + org profile/branding UI
status: done
phase: P7
module: web
priority: P1
size: M
endpoints: []
branch: task/tui-64-setup-wizard
pr:
---

# TUI-64 Onboarding wizard (full) + org profile/branding UI

Locale, tax, terms, grades, subjects, first class.

Built (D-193): the setup wizard at `/setup` (terms or rolling monthly, grade levels, subjects,
tax, first class), opened after creating a centre and from Home, and Settings › Organisation.
No API changes: every step uses the settings screens' own calls.
