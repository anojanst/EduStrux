---
id: TUI-27
title: Branches and rooms CRUD
status: done
phase: P2
module: orgs
priority: P0
size: S
endpoints:
  - GET|POST /branches
  - PATCH|DELETE /branches/{id}
  - GET|POST /branches/{id}/rooms
  - PATCH|DELETE /rooms/{id}
branch: task/tui-27-29-branches-rooms-grades-subjects
pr: 11
---

# TUI-27 Branches and rooms CRUD

Room capacity. Hide branches in single-tutor mode.

Built with TUI-29. Every org starts with a "Main" branch, created with the org; migration 0003
backfills older orgs (D-031). Single-tutor mode means exactly one branch: adding a second, or
turning the mode on with several, is refused (D-032). Only the owner writes; every role reads
(D-033). Deleting a branch is refused while it's the last one, has rooms, or staff are limited to
it; rooms can't move branch (D-034). Hiding branches in the UI is P7 work.
