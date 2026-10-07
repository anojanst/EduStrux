---
id: TUI-47
title: Public enquiry form + online enrolment requests with approval
status: todo
phase: P3
module: enrolment
priority: P0
size: M
endpoints:
  - POST /api/v1/public/{orgSlug}/enquiries
  - POST /api/v1/public/{orgSlug}/enrolment-requests
  - GET /enrolment-requests
  - POST /enrolment-requests/{id}/approve
  - POST /enrolment-requests/{id}/reject
branch:
pr:
---

# TUI-47 Public enquiry form + online enrolment requests with approval

Embeddable/link forms. Rate-limit + bot protection on public routes. Public pages use the org slug (D-020).
