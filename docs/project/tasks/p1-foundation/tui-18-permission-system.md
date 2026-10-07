---
id: TUI-18
title: 'Permission system: per-route permission + role/branch scope'
status: done
phase: P1
module: platform
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-18 Permission system: per-route permission + role/branch scope

Role→permission→scope map in packages/shared/src/permissions.ts. Branch/own scope is set on the request; each module's service must apply it to its queries.
