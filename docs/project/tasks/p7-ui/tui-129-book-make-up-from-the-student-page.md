---
id: TUI-129
title: Book make-up from the student page
status: done
phase: P7
module: web
priority: P0
size: S
endpoints:
  - GET /api/v1/orgs/{orgId}/makeup-credits
  - POST /api/v1/orgs/{orgId}/makeup-bookings
  - DELETE /api/v1/orgs/{orgId}/makeup-bookings/{bookingId}
branch: task/tui-129-book-makeup
pr:
---

# TUI-129 Book make-up from the student page

Split from TUI-40. Staff pick an available make-up credit on the student page, choose a lesson to book it into, and can cancel a booking. The API (TUI-55) already exists; this is UI only.
