---
id: TUI-72
title: Sign-in by email code for everyone (no passwords)
status: done
phase: P4
module: portal
priority: P0
size: M
endpoints: []
branch: task/tui-72-80-email-code-sign-in
pr: 81
---

# TUI-72 Sign-in by email code for everyone (no passwords)

Everyone, staff and parents, signs in with a one-time code sent to their email, with no
password (D-021, D-192). The web app has no password card or password step (this PR). No API
code needed (D-151).

Done by the owner in the Clerk dashboard, on the development and the production instance
(confirmed 2026-10-30): email verification code sign-in is on and passwords are off, so nobody is
asked for one at sign-up or sign-in.
