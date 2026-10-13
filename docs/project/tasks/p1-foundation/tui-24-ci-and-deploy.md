---
id: TUI-24
title: CI pipeline + Cloudflare deploy (staging & prod)
status: in-progress
phase: P1
module: infra
priority: P1
size: M
endpoints: []
branch: task/tui-24-deploy-workflow
pr: 19
---

# TUI-24 CI pipeline + Cloudflare deploy (staging & prod)

Typecheck, lint, test, D1 migrations, deploy. Create the D1 database with `--location oc` (D-024).

## Progress

**Done (2026-10-12):** the production deploy. The owner decided on production as the only
deployed environment for now; a dev environment comes with v1.1. Worker `edustrux`, D1 `edustrux`
and R2 `edustrux-files` (Oceania), queues `edustrux-email` and `edustrux-jobs`, migrations
0000–0008 applied. Deploy with `pnpm db:migrate:production` then `pnpm deploy:production`.
Recorded in D-064 to D-067.

**Also done (2026-10-12):** the owner set `CLERK_SECRET_KEY` on the Worker. The API docs are on
in production until launch (#20, D-068), and the owner put the Worker behind Cloudflare Access
until the app is finalised (#21, D-069). Undoing both before launch is in TUI-86.

**Done (2026-10-13):** deploy on merge. The owner asked for a GitHub Actions workflow:
`.github/workflows/deploy-production.yml` runs on every merge to `main` that changes more than
docs. It runs `pnpm typecheck` and `pnpm test`, then `pnpm db:migrate:production`, then
`pnpm deploy:production`. The repo is public, so Actions minutes are free. Recorded in D-076.

**Left:**

- The owner adds the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until
  then every run fails at the migration step and nothing is deployed.
- Checks on pull requests (typecheck, test before merge) aren't set up. The workflow only checks
  after the merge, before it deploys.
- Set `CLERK_AUTHORIZED_PARTIES` once the web app has an origin.
