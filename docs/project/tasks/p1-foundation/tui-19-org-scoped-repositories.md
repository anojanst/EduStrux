---
id: TUI-19
title: Org-scoped repository base layer + audit-log batch writes
status: done
phase: P1
module: platform
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-19 Org-scoped repository base layer + audit-log batch writes

Only code allowed to touch D1. Every fn takes orgId and adds org_id = ?. Writes = one D1 batch incl. audit_log row.
