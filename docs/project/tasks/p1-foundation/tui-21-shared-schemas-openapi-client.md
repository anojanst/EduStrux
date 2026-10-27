---
id: TUI-21
title: Shared Zod schemas + OpenAPI generation + typed API client
status: done
phase: P1
module: platform
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-21 Shared Zod schemas + OpenAPI generation + typed API client

Zod schemas + OpenAPI generation done. Typed API client still to do (generate from /api/openapi.json when the web app starts).

Done (board sync 2026-10-27): the typed client is settled by D-159. The web imports the API's types from `@edustrux/shared` (`apps/web/src/lib/api.ts`) instead of generating a client from the spec.
