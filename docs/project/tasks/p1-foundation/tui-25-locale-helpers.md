---
id: TUI-25
title: 'Locale/i18n helpers: currency, timezone, date format'
status: done
phase: P1
module: platform
priority: P0
size: S
endpoints: []
branch: task/tui-25-locale-helpers
pr: 3
---

# TUI-25 Locale/i18n helpers: currency, timezone, date format

packages/shared money.ts + dates.ts, en-* locale validator (D-015), DST "compatible" rule (D-016). Tests: apps/api/test/locale.test.ts + an orgs.test.ts locale case.
