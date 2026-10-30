---
id: TUI-72
title: Sign-in by email code for everyone (no passwords)
status: blocked
phase: P4
module: portal
priority: P0
size: M
endpoints: []
branch: task/tui-72-80-email-code-sign-in
pr: 51
---

# TUI-72 Sign-in by email code for everyone (no passwords)

Everyone, staff and parents, signs in with a one-time code sent to their email, with no
password (D-021, D-192). The web app has no password card or password step (this PR). No API
code needed (D-151).

Blocked on the owner, in the Clerk dashboard, on the development and the production instance:

- User & authentication › Email: turn on sign-in with an email verification code.
- Password: turn it off, so nobody is asked for one at sign-up or sign-in.
- Check session lifetime suits a centre (people stay signed in on their own devices).
- Sign in from a private window on production and confirm it asks only for the emailed code.
