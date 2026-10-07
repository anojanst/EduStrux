---
id: TUI-29
title: Grade levels and subjects
status: done
phase: P2
module: curriculum
priority: P0
size: S
endpoints:
  - GET|POST /grade-levels
  - PATCH|DELETE /grade-levels/{id}
  - PUT /grade-levels/order
  - GET|POST /subjects
  - PATCH|DELETE /subjects/{id}
branch: task/tui-27-29-branches-rooms-grades-subjects
pr:
---

# TUI-29 Grade levels and subjects

Org-defined ordered grades (NZ Y1–13, US K–12, SL O/L A/L).

Built with TUI-27. Grade levels are one ordered list, not paged, at most 100 per org;
`PUT /grade-levels/order` takes every id once (D-035). Names are unique per org, ignoring case
(D-034). Deleting a grade or subject will need an "in use" check once courses (TUI-30) refer to
them.
