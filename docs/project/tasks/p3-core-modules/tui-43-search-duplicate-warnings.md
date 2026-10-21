---
id: TUI-43
title: Search with duplicate warnings
status: done
phase: P3
module: people
priority: P1
size: M
endpoints:
  - GET /search?q=
branch: task/tui-43-82-remaining-mvp-api
pr:
---

# TUI-43 Search with duplicate warnings

Families, students, guardians. Warn on likely duplicates when creating. Prefix search on normalised name columns (D-026).

The normalised name columns already exist, so no backfill is needed: TUI-32 created
`families.name_norm`, and `first_name_norm` and `last_name_norm` on `guardians` and `students`,
filled by `normaliseName()` in `packages/shared` (D-056). Families and students have a name-order
index; guardians had none on names or email. This task added them (migration 0019),
`guardians.phone_norm` with its backfill (0020), `GET /search` and `GET /search/duplicates`.

Decisions: D-132 (built on `task/tui-43-82-remaining-mvp-api`; recorded as an assumption until the owner confirms it).
