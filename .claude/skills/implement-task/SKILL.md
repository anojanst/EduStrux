---
name: implement-task
description: Implement one EduStrux task from docs/project/tasks/ (or a small bundle) end to end, following the repo's module pattern, until it meets the Definition of Done. Use when the user says "implement TUI-n", "build <feature>", or the commander hands over a task.
argument-hint: '<TUI-n> [TUI-n ...] [--no-ship]'
---

# Implement task

You build a task to the Definition of Done in `CLAUDE.md`, following the patterns already in the
repo. Read `CLAUDE.md` and `README.md` (Conventions) before starting.

Arguments: `$ARGUMENTS` — one or more `TUI-n` ids. If none are given, ask which task, or suggest
running `/recommend-next`. `--no-ship` means the caller (the commander) will run the design-docs
update and the PR itself, so stop after the report.

## 1. Understand the task

1. Read the task file(s): `ls docs/project/tasks/*/tui-<n>-*.md`, or `pnpm -s board --all --json`
   for live branch and PR state. Note `endpoints`, the notes in the body, `module` and `phase`.
   If a task is `done` or `deferred`, stop and tell the user.
2. If it's a decision task (phase `P0`), stop: decisions are the user's. Ask the questions
   that would settle it, then hand over to `/update-design-docs` and `/open-pr`
   (a docs PR that marks the decision task done).
3. Create the task branch before touching code (see Git workflow in `CLAUDE.md`):
   - Check the working tree with `git status --short`. If there are uncommitted changes that don't
     belong to this task, ask the user what to do (commit them separately, stash, or carry on);
     never discard them.
   - Run `git fetch origin`, then `git switch main` and `git pull --ff-only`.
   - If the task needs code from a task that is in review (an open PR, which `pnpm board`
     shows), branch from that PR's head branch instead of `main`, and note "stacked on" for the PR.
   - Run `git switch -c task/tui-<n>-<slug>`. If that branch already exists (the task was started
     before), switch to it and continue.
4. In each task file, set `branch:` to the branch name (this change is on the task branch, so it
   ships in the PR). Leave `status` alone: `pnpm board` shows the task as in progress from the
   branch, and `/open-pr` sets `status` when it opens the PR.
5. Read the design for it in `docs/design/handoff.md`: the endpoints (§9), the tables and columns
   (§7), the permissions for each role (§6), the conventions (§5) and the feature rules (§8).
   Also read `docs/design/decisions.md`, since newer decisions override the handoff.
6. Read the reference module, `apps/api/src/modules/orgs/` (routes → service → repository), and
   `apps/api/test/orgs.test.ts`. New code should look like that code.

If the design leaves a choice open and it would be expensive to change later (data shape, money
rules, who can see what), ask the user with AskUserQuestion, giving a recommended option. For
small choices, pick a sensible default and list it in your report as a decision.

## 2. Build, in this order

**Schema** (`packages/db/src/schema/<module>.ts`, exported from `schema/index.ts`)

- Spread `...orgColumns()` into every org-owned table. Every index starts with `org_id`.
- Money is an integer minor-units column plus a currency column. Lesson dates and times are local
  `text` (`YYYY-MM-DD`, `HH:MM`). Event times are ISO UTC text.
- Add any new id prefix to `ID_PREFIXES` in `packages/shared/src/ids.ts`.
- Generate the migration with a descriptive name, and never edit an existing migration:
  `pnpm --filter @edustrux/db exec drizzle-kit generate --name <module_change>`

**Schemas** (`packages/shared/src/schemas/<module>.ts`, exported from `src/index.ts`)

- Import `z` from `../zod`. Give the resource, create and update schemas `.openapi('Name')`.
- Update schemas are `.partial()` with `updatedAt` required. Reuse `Money`, `LocalDate`,
  `LocalTime`, `PageQuery` and `page()` from `common.ts`.
- Add new permissions to `packages/shared/src/permissions.ts` only if none fits. Mirror the
  handoff §6 table for every role.

**Repository** (`apps/api/src/modules/<module>/repository.ts`)

- The only file that queries D1. Every function takes `OrgCtx` and filters with
  `inOrg(ctx, table, ...)`.
- Every write goes through `writeWithAudit(ctx, [statements], { action: '<entity>.<verb>', ... })`.
- Soft delete sets `deletedAt`. Lists take `limit` and a decoded cursor, order by id, and fetch
  `limit + 1`.

**Service** (`service.ts`)

- Business rules, `updatedAt` stale checks (`staleData()`), uniqueness and existence checks.
  Throw the helpers from `lib/errors.ts`.
- Apply the role's scope: `branch` limits to `membership.branchIds` (when it isn't null), and
  `own` limits to the teacher's classes or the parent's family. Pass the scope in from the route.
- Call other modules only through their service functions, never their tables.
- Map rows to API shapes (camelCase, no `orgId`/`deletedAt`).

**Routes** (`routes.ts`)

- `createRoute` with `tags`, `summary`, `middleware: orgAccess('<permission>')`, params built from
  `OrgParams.extend({...})`, `jsonBody(...)` for bodies, and `json(...)` plus `errors(...)` for
  every response.
- POST returns 201. DELETE returns 204 with an empty body. Long work returns 202 `{ jobId }` and
  registers a handler in `JOB_HANDLERS` (`background/jobs.ts`).
- Invoices, payments and bulk actions add `idempotent(byOrg)` after `orgAccess(...)`.
- Mount the router in `apps/api/src/app.ts`.

**Tests** (`apps/api/test/<module>.test.ts`, using the helpers in `test/helpers.ts`)

- The happy path for every endpoint.
- Validation errors (400 with `fields`).
- Another org's ids return 404 for every route.
- Each role that must be refused gets 403, and scoped roles only see their branch or own records.
- Writes leave an audit row. PATCH with a stale `updatedAt` returns 409.
- The business rules from the handoff (pro-rata, clashes, capacity, and so on).

## 3. Verify

```bash
pnpm typecheck
pnpm test
```

Fix until both pass. If something can't be fixed without a design change, stop and explain.
Don't weaken a test to make it pass. Optionally start `pnpm dev` and check the new routes appear
in Swagger at `/api/docs`.

## 4. Report

Don't commit here, and don't change the task's `status`: `/open-pr` sets it when it opens the
PR, and merging the PR makes the task done on `main`.

Write this report (`/update-design-docs` and `/open-pr` read it):

```
## Implemented: TUI-n <title>
Branch: task/tui-n-<slug> (base: main | stacked on task/tui-m-…)
Endpoints: <method path permission, ...>
Tables / migration: <names, migration file>
Tests: <file — N cases>; typecheck ✓ tests ✓ (total passed)
Design changes (for /update-design-docs):
- <deviation from the handoff, or a new decision, with reason>  (or "none")
How to test: <2–4 concrete Swagger calls, incl. one 403 role and one owner_b 404>
Review focus: <riskiest 1–3 spots>
Follow-ups: <TODOs left in code, things for later tasks>
```

## 5. Ship (skip with `--no-ship`)

Run on its own, this skill finishes the task's delivery:

1. `Skill(update-design-docs, "<the report>")`. Its edits land on this branch, so they go in the
   same PR.
2. `Skill(open-pr, "TUI-n --report <the report>")`. This marks the task file done, commits,
   pushes and opens the PR.

Finish by giving the user the PR link.
