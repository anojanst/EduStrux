---
id: TUI-61
title: File uploads to R2 with signed links
status: done
phase: P3
module: platform
priority: P1
size: S
endpoints:
  - POST /files/upload-url
  - GET /files/{id}
branch: task/tui-43-82-remaining-mvp-api
pr: 51
---

# TUI-61 File uploads to R2 with signed links

Keys under orgs/{orgId}/.

Decisions: D-145 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
