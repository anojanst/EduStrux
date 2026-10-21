---
id: TUI-65
title: Email queue consumer via Resend
status: done
phase: P4
module: comms
priority: P0
size: M
endpoints: []
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-65 Email queue consumer via Resend

Render template → Resend → retry with backoff → update delivery status. D-015: system email strings (reminders, session changes) come from an en catalog keyed by id, same shape as the web catalog. No multi-language support; guardians.language not used. Parent sign-in emails are sent by Clerk (D-021).

Decisions: D-136 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
