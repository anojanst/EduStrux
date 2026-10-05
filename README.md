# EduStrux

SaaS for running tuition centres. API-first: the whole MVP API is built and tested through
Swagger before the web app.

```
apps/api/          Hono on Cloudflare Workers: REST API, cron handlers, queue consumers
packages/shared/   Zod schemas, roles & permissions, ID generator, money/date helpers (shared with web/mobile later)
packages/db/       Drizzle schema + D1 migrations
```

Design spec: [docs/design/handoff.md](docs/design/handoff.md) · decisions:
[docs/design/decisions.md](docs/design/decisions.md) · task board and build skills:
[CLAUDE.md](CLAUDE.md)

## Setup

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # add your Clerk development secret key
pnpm db:migrate                                     # apply migrations to local D1
pnpm seed                                           # test users per role, in 2 orgs
pnpm dev                                            # http://localhost:8787
```

## Trying the API in Swagger

1. Open http://localhost:8787/api/docs.
2. Run `pnpm dev:token owner` and copy the printed token.
3. Click **Authorize**, paste the token, and call endpoints. The token lasts 8 hours.

Seeded users: `owner`, `branch_manager`, `front_desk`, `teacher`, `parent`, `accountant`
(all in Bright Minds Tuition) and `owner_b` (Harmony Music School). Use another role's token
to check permissions, and `owner_b` against Bright Minds ids to check org isolation (404).

`pnpm -s dev:token owner --raw` prints just the token, for curl:

```bash
TOKEN=$(pnpm -s dev:token owner --raw)
curl -H "Authorization: Bearer $TOKEN" localhost:8787/api/v1/me
```

The scripts refuse anything but a Clerk **development** key (`sk_test_…`).

## Commands

| Command            |                                                               |
| ------------------ | ------------------------------------------------------------- |
| `pnpm dev`         | API on :8787 with local D1, R2 and Queues                     |
| `pnpm test`        | Vitest inside the Workers runtime, against a fresh local D1   |
| `pnpm typecheck`   | All packages                                                  |
| `pnpm db:generate` | New migration from schema changes in `packages/db/src/schema` |
| `pnpm db:migrate`  | Apply migrations locally                                      |

## Conventions

- **Org isolation.** Every table except `users` has `org_id`; every index leads with it.
  Only repositories (`apps/api/src/modules/*/repository.ts`) query D1, and every repository
  function takes an `OrgCtx`. Use `inOrg(ctx, table, …)` in every org-scoped `where`.
- **Request pipeline** for `/api/v1/orgs/{orgId}/…`: `orgAccess('<permission>')` runs Clerk
  auth → membership (404 for non-members) → the route's single permission (403).
- **Writes** go through `writeWithAudit`, which batches them with an audit-log row.
- **Modules** (`apps/api/src/modules/<name>/`) own their routes, service and repository, and call
  each other only through services.
- **API format**: JSON, camelCase, locale-neutral (no `Accept-Language`, no translated text).
  Errors are `{ error: { code, message, fields? } }`: `code` is a stable key the client
  translates, `message` is English for developers (D-015). Lists use
  `?limit&cursor` → `{ data, nextCursor }`. PATCH takes the `updatedAt` you last read (stale →
  409). Money is `{ amount, currency }` in minor units. Long actions return `202 { jobId }`.
  `Idempotency-Key` makes POSTs retry-safe.
- **Money and dates** go through the helpers in `packages/shared` (`money.ts`, `dates.ts`),
  shared by the API and the web app: decimal strings ↔ minor units without floats, local date
  maths, local time ↔ UTC in the org's timezone (DST rule D-016), and formatting with the org's
  locale and date format.
- **Tests** sign their own Clerk-shaped tokens with a throwaway key, verified through the same
  code path as production. See `apps/api/test/helpers.ts`.

## Branches and pull requests

`main` is protected: commit on a branch (`task/tui-<n>-<slug>`) and open a pull request. Git
hooks in `.githooks/` (installed by `pnpm install`) block commits and pushes to `main`. See the
Git workflow in [CLAUDE.md](CLAUDE.md).

Claude Code commits and opens PRs as a separate bot account, so you can review and approve them.
Set it up once with `scripts/setup-claude-bot.sh <bot-username>`.

## Before the first deploy

- `wrangler d1 create edustrux` and put the id in `apps/api/wrangler.jsonc`.
- Create the R2 bucket and queues named in `wrangler.jsonc`.
- `wrangler secret put CLERK_SECRET_KEY` (or `CLERK_JWT_KEY`), set `CLERK_AUTHORIZED_PARTIES`
  to your web origins, and `ENABLE_DOCS` to `false` in production.
