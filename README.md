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

| Command            |                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| `pnpm dev`         | API on :8787 with local D1, R2 and Queues                                              |
| `pnpm test`        | Vitest inside the Workers runtime, against a fresh local D1                            |
| `pnpm typecheck`   | All packages                                                                           |
| `pnpm db:generate` | New migration from schema changes in `packages/db/src/schema`                          |
| `pnpm db:migrate`  | Apply migrations locally                                                               |
| `pnpm db:studio`   | Browse and edit the local D1 database in Drizzle Studio (https://local.drizzle.studio) |
| `pnpm board`       | The project board from `docs/project/tasks/` ([how it works](docs/project/README.md))  |

## Conventions

- **Org isolation.** Every table except `users` has `org_id`; every index leads with it.
  Only repositories (`apps/api/src/modules/*/repository.ts`) query D1, and every repository
  function takes an `OrgCtx`. Use `inOrg(ctx, table, …)` in every org-scoped `where`.
- **Request pipeline** for `/api/v1/orgs/{orgId}/…`: `orgAccess('<permission>')` runs Clerk
  auth → membership (404 for non-members) → the route's single permission (403). Where that
  permission's scope is `branch` or `own`, pass `access(c)` to the service, which narrows its
  queries to the caller's branches or own records and returns 404 outside them (D-048).
- **Writes** go through `writeWithAudit`, which batches them with an audit-log row.
- **D1 limit:** at most 100 bound values per SQL statement. Insert many rows in chunks, and pass
  a long id list with `inIds(column, ids)`, which binds it as one JSON value.
- **Who can see what.** A service's `reachOf(ctx, access)` turns the caller's role into a filter
  for its repository, and makes no D1 call (D-104). Where the rule belongs to another module,
  ask that module's service for it as a query for ids: `classes.classesTaughtBy` and
  `classesInBranches`, `people.studentsOfGuardian`, `studentsInBranches`, `familiesOfGuardian`
  and `familiesInBranches`, `enrolment.studentsTaughtBy`, `classesOfChildren`,
  `studentsEnrolledIn` and `classesOfStudents`. Never read the ids first to filter by them. A
  new rule is a function like these in the module that owns it, built with `idsFrom`, or from
  another module's query.
- **Ids.** A list of ids to filter by has the type `Ids` (`apps/api/src/db/scope.ts`): real ids,
  or a query for them that is written into the statement it filters and costs no trip. A
  repository takes `Ids` wherever it takes ids and filters with `inIds(column, ids)`, the same
  for both. `idsFrom(ctx, table, column, …conditions)` makes a query and puts the org in it.
- **Reading across modules.** A repository names only its own module's tables. To filter by
  another module's rows, take a query for ids from its service. To show another module's rows
  beside yours, give its load-by-ids function (`people.studentNames`, `people.familyLabels`,
  `classes.classLabels`) a query for the ids your read returns, made with `idsFrom` from the same
  conditions and `firstIds` for a page, and send both with `Promise.all`: one stage (D-104).
- **Bulk writes:** a change that adds or removes many sessions writes one audit row with the
  counts, not one per session (D-045). Other bulk writes follow that unless the owner decides
  otherwise.
- **Rows read.** D1 bills the rows a statement reads, and production has no table statistics to
  steer SQLite. For a lookup by ids, real or a query, give `inIds(column, ids)` straight to
  `inOrg`, which then makes SQLite go to the ids (D-100, D-104). That suits ids that are few: a
  parent's children, a teacher's classes. Everything in some branches is marked `wide` by the
  function that makes the query. A statement never goes to wide ids: it reads its page in the
  page's own order and looks each row up (D-104). Inside `and()` or `or()`, ids only narrow what
  something else finds. A list paged by id needs a unique index on `(org_id, id)`, and an index
  one of its filters uses must end with `id` (D-101). `apps/api/test/query-plans.test.ts` checks
  the plans: add a row there for a new lookup, reach or list.
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
  locale and date format. An amount worked out from a price (pro-rata, tax) stays in integer
  minor units and rounds halves up (D-093).
- **Names** of families and people are stored as typed and again normalised, in a `*_norm` column
  filled by `normaliseName()` from `packages/shared`. Sort and search on the normalised column. A
  list in name order puts every sort key in its cursor with `byKeys` and `decodeKeys` (D-056).
- **Database round trips.** Every API response says what it cost in D1 calls in a `Server-Timing`
  header, `db;dur=<ms>;trips=<n>;stages=<n>`. A test reads them from `call()`: `res.db.trips` is
  the calls the request made (a statement is one, a batch is one) and `res.db.stages` is how many
  of them it waited for one after another, so calls sent together count once (D-099). The budget
  for every endpoint is about 3 stages: sign-in, one read stage, one write (D-102). A service
  that needs the org calls `orgs.getOrg(ctx)`, which costs no call in a request.
- **Tests** sign their own Clerk-shaped tokens with a throwaway key, verified through the same
  code path as production. See `apps/api/test/helpers.ts`.

## Branches and pull requests

`main` is protected: commit on a branch (`task/tui-<n>-<slug>`) and open a pull request. Git
hooks in `.githooks/` (installed by `pnpm install`) block commits and pushes to `main`. See the
Git workflow in [CLAUDE.md](CLAUDE.md).

Claude Code commits and opens PRs as a separate bot account, so you can review and approve them.
Set it up once with `scripts/setup-claude-bot.sh <bot-username>`.

## Deploying

There is one deployed environment, production, at https://edustrux.edustrux-api.workers.dev: the
Worker `edustrux` with the D1 database `edustrux` and the R2 bucket `edustrux-files` (both in
Oceania) and the queues `edustrux-email` and `edustrux-jobs`. Its vars and bindings are under
`env.production` in `apps/api/wrangler.jsonc`; the top level of that file is local development
and tests.

Merging to `main` deploys it. The workflow
[.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml) runs
`pnpm typecheck` and `pnpm test`, applies new migrations to the production D1, then deploys the
Worker. A failed check or migration stops it before the deploy.

- Merges that only change `docs/`, Markdown files or `.claude/` don't start it.
- It can be started by hand from the repository's Actions tab ("Run workflow"). Only `main` is
  ever deployed.
- It needs two repository secrets, set once by the owner with `gh secret set <NAME>`:
  `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`, a custom Cloudflare API token for this
  account only with three account permissions: Workers Scripts: Edit (the deploy), D1: Edit (the
  migrations) and Queues: Edit (a deploy rewrites the queue consumer settings). A custom domain
  will add Zone → Workers Routes: Edit for its zone.

To deploy from your own machine instead:

```bash
pnpm --filter @edustrux/api exec wrangler login   # once per machine
pnpm db:migrate:production                         # apply new migrations to the remote D1
pnpm deploy:production
```

- `deploy:production` turns off wrangler's automatic resource creation, so a binding to
  something that doesn't exist fails the deploy instead of creating it. Create new resources on
  purpose (`wrangler r2 bucket create`, `wrangler queues create`).
- Secrets are set once, by the owner:
  `pnpm --filter @edustrux/api exec wrangler secret put CLERK_SECRET_KEY --env production` (or
  `CLERK_JWT_KEY`).
- Swagger is on in production for now, at `/api/docs`, because production is the only deployed
  environment (D-068).
- The whole deployed API is behind Cloudflare Access until the app is finalised (D-069). A
  browser signs in through Access first; curl and other non-browser clients need an Access
  service token. Access is set up in the Cloudflare dashboard, not in this repo.
- Before launch: remove or narrow Access, set `ENABLE_DOCS` back to `false` under
  `env.production`, and set `CLERK_AUTHORIZED_PARTIES` to the web app's origins.
