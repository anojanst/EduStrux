---
id: TUI-41
title: 'E2E test: onboarding → class → enrolment → attendance → invoice → payment'
status: done
phase: P2
module: infra
priority: P0
size: M
endpoints: []
branch: task/tui-41-e2e-vertical-slice
pr: 42
---

# TUI-41 E2E test: onboarding → class → enrolment → invoice → payment

Suggested first E2E flow in handoff.

Decided by the owner on 2026-10-14 (D-114): build it now with what exists, as onboarding → class
setup → enrolment → attendance → invoice generation. Payment is added to the same test when it
lands.

Built in `apps/api/test/e2e.test.ts` with payment included, now that TUI-38 has landed (D-123).
The test moves the clock to the first lesson, and writes the teacher's and parent's memberships
straight to the database until invitations exist (TUI-42, TUI-72).
