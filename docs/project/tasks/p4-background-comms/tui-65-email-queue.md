---
id: TUI-65
title: Email queue consumer via Resend
status: todo
phase: P4
module: comms
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-65 Email queue consumer via Resend

Render template → Resend → retry with backoff → update delivery status. D-015: system email strings (reminders, session changes) come from an en catalog keyed by id, same shape as the web catalog. No multi-language support; guardians.language not used. Parent sign-in emails are sent by Clerk (D-021).
