---
id: TUI-83
title: Monitoring, error tracking and backups check
status: done
phase: P6
module: infra
priority: P1
size: S
endpoints: []
branch: task/tui-81-83-rate-limits-monitoring
pr: 80
---

# TUI-83 Monitoring, error tracking and backups check

Free tier to start.

Built as D-191: Workers Issues, `GET /api/v1/health/ready`, the uptime workflow (off until
`UPTIME_URL` is set), the nightly backup check, and the restore steps in the README.
