---
id: TUI-88
title: 'Dev token script: get Clerk Bearer tokens for Swagger/curl'
status: in-progress
phase: P1
module: platform
priority: P0
size: S
endpoints: []
branch:
pr:
---

# TUI-88 Dev token script: get Clerk Bearer tokens for Swagger/curl

pnpm seed + pnpm dev:token <role> written. Not yet run against a real Clerk dev instance (needs CLERK_SECRET_KEY in apps/api/.dev.vars). Uses getToken expiresInSeconds instead of a JWT template. Needs the owner to confirm.
