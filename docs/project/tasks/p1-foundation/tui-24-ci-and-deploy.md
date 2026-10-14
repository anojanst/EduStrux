---
id: TUI-24
title: CI pipeline + Cloudflare deploy (staging & prod)
status: done
phase: P1
module: infra
priority: P1
size: M
endpoints: []
branch: task/tui-24-ci-test-timeout
pr: 26
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

**First run (2026-10-13):** merging #24 started the workflow, and it stopped at the tests, so
nothing was migrated or deployed. 15 tests in `classes.test.ts` and `people.test.ts` ran past
vitest's 5s default on the GitHub runner; none failed an assertion. `testTimeout` is now 30s.

**Deployed by the workflow (2026-10-13):** the runs for #26 and #25 passed the tests, applied
migrations 0009 and 0010 to the production D1 and deployed the Worker. That confirmed the token's
three permissions. Afterwards no migrations were left to apply, and the address still went to the
Cloudflare Access sign-in page.

**Not part of this task:**

- Checks on pull requests (typecheck, test before merge) weren't built. The workflow checks after
  the merge, before it deploys. The owner decided to add them on 2026-10-14 (D-117): TUI-104.
- `CLERK_AUTHORIZED_PARTIES` is set once the web app has an origin. It is on the before-launch
  list in TUI-86.
