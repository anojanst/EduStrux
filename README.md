# EduStrux

SaaS for running tuition centres. API-first: the whole MVP API is built and tested through
Swagger before the web app.

```
apps/api/          Hono on Cloudflare Workers: REST API, cron handlers, queue consumers
apps/web/          React + Vite: staff app and parent portal (Clerk sign-in, TanStack Query, Tailwind)
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
cp apps/web/.env.example apps/web/.env.local        # add the same instance's publishable key
pnpm db:migrate                                     # apply migrations to local D1
pnpm seed                                           # test users per role, in 2 orgs
pnpm dev                                            # API on :8787, web app on :5173
```

The web app's dev server sends `/api` to the API on :8787, so both run on one origin as in
production. Sign up at http://localhost:5173/sign-up to start a centre; an invite link from
`POST /staff/invitations` or `POST /guardians/{id}/invitation` opens at `/invitations/{token}`.

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
| `pnpm dev`         | API on :8787 with local D1, R2 and Queues, and the web app on :5173                    |
| `pnpm test`        | API: Vitest in the Workers runtime on a fresh local D1. Web: Vitest with jsdom         |
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
- **Writes** go through `writeWithAudit`, which batches them with an audit-log row. An update
  spreads `changedFields(before, changes)` (`apps/api/src/db/scope.ts`) into its audit entry,
  so `before` and `after` hold only the fields whose value changes. Creates and deletes store
  the whole row (D-113, D-125).
- **Rules two requests can break at once.** A service checks its rules on what it read, so two
  requests at once can both pass. Where that would leave the data wrong, the database holds the
  rule too: a partial unique index where one can (D-094), else a trigger in a custom SQL
  migration (`drizzle-kit generate --custom`) that raises a named error. The repository
  recognises the error and the service answers 409 `stale_data`; the service still checks first,
  so a client gets the specific error when nothing raced. Drizzle's schema doesn't know a
  trigger: say so in a comment on the table, and a migration that rebuilds the table must create
  the trigger again (D-120).
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
- **Fields some roles don't see.** Leave the field out of the response, not null, so null keeps
  meaning "not set", and mark it `.optional()` in the shared schema. The service passes every
  record a read returns through a `forReader(record, access)` step. A write's response isn't
  trimmed while every role that can make the write sees the field (D-127).
- **Ids.** A list of ids to filter by has the type `Ids` (`apps/api/src/db/scope.ts`): real ids,
  or a query for them that is written into the statement it filters and costs no trip. A
  repository takes `Ids` wherever it takes ids and filters with `inIds(column, ids)`, the same
  for both. `idsFrom(ctx, table, column, …conditions)` makes a query and puts the org in it. A
  query's conditions may read a column of the row it filters: the classes an enrolment covers on
  a session's own date. Such a query only narrows, so give `inOrg` ids it can go to before it
  (D-108).
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
- **Web app** (`apps/web`): take request and response types from `@edustrux/shared` with
  `import type` (no generated client), and role checks from `@edustrux/shared/permissions`, so
  zod stays out of the bundle (D-159). Every string goes through `t()` and the `en` catalog;
  only Clerk's sign-in and sign-up screens carry their own text (D-160). Primitives live in
  `src/components/ui/`, styled with the Tailwind token classes from ui-design §2 (D-158).
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
- **End-to-end tests** go in `apps/api/test/e2e.test.ts`: one flow through the API, each step
  using what the steps before it made. A step that needs a later moment fakes only `Date`
  (`vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })` and `vi.setSystemTime`),
  which the API sees too, as tests run in the same Workers isolate. Sign a token per request so
  it doesn't expire after the jump, and restore the clock in `afterEach` (D-123).

## Branches and pull requests

`main` is protected: commit on a branch (`task/tui-<n>-<slug>`) and open a pull request. Git
hooks in `.githooks/` (installed by `pnpm install`) block commits and pushes to `main`. See the
Git workflow in [CLAUDE.md](CLAUDE.md).

Every pull request runs `pnpm typecheck` and `pnpm test`
([.github/workflows/pr-checks.yml](.github/workflows/pr-checks.yml)), except one that only changes
`docs/`, Markdown files or `.claude/`. A failing run doesn't block the merge (D-117, D-124).

Claude Code commits and opens PRs as a separate bot account, so you can review and approve them.
Set it up once with `scripts/setup-claude-bot.sh <bot-username>`.

## Deploying

There is one deployed environment, production, at https://app.edustrux.com: the
Worker `edustrux` with the D1 database `edustrux` and the R2 bucket `edustrux-files` (both in
Oceania) and the queues `edustrux-email` and `edustrux-jobs`. Its vars and bindings are under
`env.production` in `apps/api/wrangler.jsonc`; the top level of that file is local development
and tests.

Merging to `main` deploys it. The workflow
[.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml) runs
`pnpm typecheck` and `pnpm test`, applies new migrations to the production D1, then builds the
web app and deploys the Worker with it. A failed check, migration or build stops it before the
deploy.

The Worker serves the web app too: `/api/*` reaches the API, and every other path is a file from
`apps/web/dist` or, for the app's own pages, its `index.html`. Locally nothing changes: Vite
serves the app and sends `/api` to `wrangler dev`.

- Merges that only change `docs/`, Markdown files or `.claude/` don't start it.
- It can be started by hand from the repository's Actions tab ("Run workflow"). Only `main` is
  ever deployed.
- It needs two repository secrets, set once by the owner with `gh secret set <NAME>`:
  `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`, a custom Cloudflare API token for this
  account only with three account permissions: Workers Scripts: Edit (the deploy), D1: Edit (the
  migrations) and Queues: Edit (a deploy rewrites the queue consumer settings), plus the zone
  permission Workers Routes: Edit on edustrux.com for the custom domain `app.edustrux.com`.
- It needs one repository variable, `VITE_CLERK_PUBLISHABLE_KEY`
  (`gh variable set VITE_CLERK_PUBLISHABLE_KEY`): the publishable key of the Clerk instance whose
  secret key is on the Worker. It's public and goes into the web build. Without it the build stops
  and nothing is deployed.

To deploy from your own machine instead:

```bash
pnpm --filter @edustrux/api exec wrangler login   # once per machine
pnpm db:migrate:production                         # apply new migrations to the remote D1
pnpm deploy:production
```

- `deploy:production` builds the web app first. On a machine the key comes from
  `VITE_CLERK_PUBLISHABLE_KEY` in the shell, else `apps/web/.env.production.local`, else
  `apps/web/.env.local`, which holds the development instance's key. Make sure it's the instance
  whose secret key is on the Worker.
- `deploy:production` also turns off wrangler's automatic resource creation, so a binding to
  something that doesn't exist fails the deploy instead of creating it. Create new resources on
  purpose (`wrangler r2 bucket create`, `wrangler queues create`).
- Secrets are set once, by the owner:
  `pnpm --filter @edustrux/api exec wrangler secret put CLERK_SECRET_KEY --env production` (or
  `CLERK_JWT_KEY`).
- Swagger is off in production since the app went public; use it locally (D-068).
- The whole deployed API is behind Cloudflare Access until the app is finalised (D-069). A
  browser signs in through Access first; curl and other non-browser clients need an Access
  service token. Access is set up in the Cloudflare dashboard, not in this repo.
- Access no longer covers `app.edustrux.com`, which is public since 2026-10-31.
  `CLERK_AUTHORIZED_PARTIES` there lists the origins the app is served from;
  add each new one.

## Monitoring and restoring

Everything here is on free tiers: Workers Logs, Workers Issues (free during its beta), the rate
limiters, R2 and GitHub Actions on a public repository.

- **Errors:** production has Workers Issues on (`observability.issues` under `env.production`).
  Uncaught exceptions, 5xx responses and `console.error` lines are grouped into issues under
  Workers & Pages → `edustrux` → Issues, with stacks mapped to our source files. To be told about
  a new issue, add an automation there (email, chat or webhook). That's a dashboard step for the
  owner. Logs are kept 7 days.
- **Rate limits:** each signed-in user gets 600 requests a minute and each org 3,000, counted in
  each Cloudflare location (`ratelimits` under `env.production`; D-191). Over that, the API
  answers 429 with `Retry-After: 60`. Nothing is limited locally or in tests.
- **Uptime:** [.github/workflows/uptime.yml](.github/workflows/uptime.yml) calls
  `GET /api/v1/health/ready` every 15 minutes, which answers 200 only once D1 has answered a query.
  A failed run is the alert: GitHub emails whoever last changed the workflow's schedule. It's off
  until the owner sets it up:
  1. In Cloudflare Zero Trust → Access → Service Auth, create a service token. On the Access
     application that covers the Worker, add a policy with the action Service Auth that allows
     that token.
  2. `gh secret set CF_ACCESS_CLIENT_ID` and `gh secret set CF_ACCESS_CLIENT_SECRET` with the
     token's id and secret.
  3. `gh variable set UPTIME_URL --body https://app.edustrux.com`.
  4. Start it once by hand from the Actions tab to see it pass.
- **Backups:** each night every org's export goes to `backups/{orgId}/{local date}.json` in the
  `edustrux-files` bucket, and the last 14 nights are kept (D-149). The daily cron checks that each
  org older than a day has last night's backup, and logs an error, which becomes an issue, for one
  that doesn't.

### Restoring

- **The whole database** (a bad migration, or data lost across orgs): D1 Time Travel restores the
  database to any minute in the last 30 days on the Workers Paid plan, or 7 days on Free. It
  replaces every org's data, so note the time just before the problem first.

  ```bash
  cd apps/api
  pnpm exec wrangler d1 time-travel info edustrux --env production --timestamp=2026-10-30T02:00:00Z
  pnpm exec wrangler d1 time-travel restore edustrux --env production --timestamp=2026-10-30T02:00:00Z
  ```

  A restore can be undone: it prints the bookmark of the database as it was just before, and
  `restore --bookmark=<that>` goes back to it. Apply any migrations newer than the restored point
  again with `pnpm db:migrate:production`.

- **One org** (a mistake that only touched one centre): don't restore the whole database. Fetch
  its backup and put back what was lost:

  ```bash
  pnpm --filter @edustrux/api exec wrangler r2 object get \
    edustrux-files/backups/<orgId>/<YYYY-MM-DD>.json --remote --file backup.json
  ```

  The file is the org's full export, the same document as `POST /exports`: every table, by id.
  The app has no "restore from backup" yet, so rows are put back by hand from it.
