---
id: TUI-15
title: Define core D1 schema (all tables from data model)
status: done
phase: P1
module: infra
priority: P0
size: L
endpoints: []
branch:
pr:
---

# TUI-15 Define core D1 schema (all tables from data model)

Migration 0000_foundation: users, orgs, memberships, invitations, audit_log, jobs, idempotency_keys (0001_jobs_attempts adds jobs.attempts). Other tables land with their modules.

Done (board sync 2026-10-27): all 49 tables in handoff §7 are in `packages/db/src/schema` on `main`, with migrations through 0034.
