---
id: TUI-86
title: Beta launch with first centres
status: todo
phase: P6
module: decisions
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-86 Beta launch with first centres

Toward the 26–30 centres target. Needs the owner.

Before launch, three steps:

- Turn the API docs off in production again (`ENABLE_DOCS` to `false` under `env.production`,
  then redeploy). They are on until launch (D-068).
- Remove or narrow Cloudflare Access on the Worker `edustrux`, in the Cloudflare dashboard. It
  covers all traffic until the app is finalised and would block real customers (D-069).
- Set `CLERK_AUTHORIZED_PARTIES` under `env.production` to the web app's origins. It is empty
  until the web app has one, so the token's `azp` claim isn't checked (D-066). Moved here from
  TUI-24.
