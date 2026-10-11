---
id: TUI-43
title: Search with duplicate warnings
status: todo
phase: P3
module: people
priority: P1
size: M
endpoints:
  - GET /search?q=
branch:
pr:
---

# TUI-43 Search with duplicate warnings

Families, students, guardians. Warn on likely duplicates when creating. Prefix search on normalised name columns (D-026).

The normalised name columns already exist, so no backfill is needed: TUI-32 created
`families.name_norm`, and `first_name_norm` and `last_name_norm` on `guardians` and `students`,
filled by `normaliseName()` in `packages/shared` (D-056). Families and students have a name-order
index; guardians have none on names or email. Still to do here: the search indexes on guardian
names and email, phone normalisation, `GET /search` and the duplicate warnings.
