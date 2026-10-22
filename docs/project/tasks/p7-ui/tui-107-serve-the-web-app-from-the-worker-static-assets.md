---
id: TUI-107
title: Serve the web app from the Worker (static assets, SPA fallback, CLERK_AUTHORIZED_PARTIES)
status: todo
phase: P7
module: web
priority: P0
size: S
endpoints: []
branch:
pr:
---

# TUI-107 Serve the web app from the Worker (static assets, SPA fallback, CLERK_AUTHORIZED_PARTIES)

Found while building TUI-23. The web app runs in development through Vite, which proxies `/api` to
`wrangler dev`. Production needs the Worker to serve `apps/web/dist` (Workers static assets with
`not_found_handling: "single-page-application"` and the Worker run first for `/api/*`), the build
step before `deploy:production`, `VITE_CLERK_PUBLISHABLE_KEY` at build time, and
`CLERK_AUTHORIZED_PARTIES` set to the app's origin (handoff §4). Cloudflare Access still covers all
traffic until launch (D-069).
