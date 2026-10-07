---
id: TUI-66
title: Jobs queue consumer + progress tracking
status: done
phase: P4
module: platform
priority: P0
size: M
endpoints:
  - GET /jobs/{id}
branch: task/tui-66-jobs-runner-tests
pr: 4
---

# TUI-66 Jobs queue consumer + progress tracking

Term invoices, roll-over, promotion, imports, PDF batches. Tests for polling, runJob and the queue consumer; startJob() helper; jobs.attempts column; D-017 (failed only on the last try) and D-018 (only the starter and owner can read a job).
