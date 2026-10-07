---
id: TUI-87
title: Swagger UI for API docs (/api/docs)
status: done
phase: P1
module: platform
priority: P0
size: S
endpoints:
  - GET /api/openapi.json
  - GET /api/docs
branch:
pr:
---

# TUI-87 Swagger UI for API docs (/api/docs)

@hono/zod-openapi generates the spec from routes; @hono/swagger-ui serves it. Bearer JWT security scheme, persistAuthorization on. Open in dev/staging; off in prod (D-002).
