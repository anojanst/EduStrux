---
id: TUI-88
title: 'Dev token script: get Clerk Bearer tokens for Swagger/curl'
status: done
phase: P1
module: platform
priority: P0
size: S
endpoints: []
branch:
pr:
---

# TUI-88 Dev token script: get Clerk Bearer tokens for Swagger/curl

pnpm seed + pnpm dev:token <role> written. Uses getToken expiresInSeconds instead of a JWT template (D-003).

Confirmed by the owner 2026-10-08 against their real Clerk development instance: `pnpm seed` populated the local DB, `pnpm dev:token teacher` minted a token, and tokens from `pnpm dev:token teacher` and `pnpm dev:token owner_b` were accepted by GET /api/v1/me on the local dev server with the right role and org (teacher at Bright Minds Tuition, owner at Harmony Music School). Owner tokens were already in use in Swagger. D-003's "Not yet run against a real Clerk instance" no longer holds; update it in docs/design/decisions.md.
