---
id: TUI-117
title: Purge enquiries and enrolment requests once decided
status: todo
phase: P6
module: enrolment
priority: P1
size: S
endpoints: []
branch:
pr:
---

# TUI-117 Purge enquiries and enrolment requests once decided

D-171 (assumption that follows from the least-data rule).

- Enquiries: name, email, phone, student name, message and `ip_hash` are cleared 30 days after
  the enquiry is handled, or 6 months after it arrived if it never is. The row keeps its id,
  branch, status and dates for counts.
- Enrolment requests: the `guardian` and `students` JSON, `notes` and `ip_hash` are cleared 30
  days after the request is approved or rejected. `result` keeps the ids made on approval.
- Message recipients stop storing a copy of the guardian's email; the guardian id is enough.
  The migration drops `message_recipients.email`.
- Runs in the daily cron. Tests cover each window and that undecided requests are kept.
