---
id: TUI-5
title: 'Decide org addressing: /orgs/{orgId} URL vs subdomain per centre'
status: done
phase: P0
module: decisions
priority: P0
size: S
endpoints: []
branch: docs/tui-1-10-p0-decisions
pr: 5
---

# TUI-5 Decide org addressing: /orgs/{orgId} URL vs subdomain per centre

Affects org middleware and routing. Handoff API assumes /orgs/{orgId}. Decided: path-based, with the org slug for public pages (D-020).
