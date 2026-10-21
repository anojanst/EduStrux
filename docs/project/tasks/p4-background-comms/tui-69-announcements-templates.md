---
id: TUI-69
title: Announcements + message templates
status: done
phase: P4
module: comms
priority: P0
size: L
endpoints:
  - GET|POST /messages
  - GET /messages/{id}
  - GET|POST /message-templates
  - PATCH|DELETE /message-templates/{id}
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-69 Announcements + message templates

Audiences: all, branch, grade, subject, class, teacher's students, custom list. Email + portal channels.

Decisions: D-135 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
