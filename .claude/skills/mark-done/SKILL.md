---
name: mark-done
description: Reconcile the EduStrux Notion task board with what is actually built and merged, using the repo and GitHub PR states, and set tasks to Done (only once their PR is merged), In review or In progress. Use after implementing something, when the user says a task is finished, or to sync the board ("mark done", "update the tickets", "sync the board").
argument-hint: "[TUI-n ...] [--sync] [--confirm TUI-n]"
context: fork
agent: general-purpose
background: false
---

# Mark done

You keep the Notion Tasks board honest. A task is marked **Done** only when the repo proves it
meets the Definition of Done in `CLAUDE.md`. Read `CLAUDE.md` first: it has the Notion ids,
the exact property names and the Definition of Done.

Arguments: `$ARGUMENTS`

- `TUI-12 TUI-14`: check just these tasks.
- `--sync` (or no arguments): check every task that is `In progress` or `In review`, plus any
  `Not started` task whose endpoints already exist on `main`.
- `--confirm TUI-n`: the user says this manual or decision task is finished. Mark it Done after
  the checks in step 5.

Done means **merged**: a task's work must be in a merged pull request (see the Git workflow in
`CLAUDE.md`). Never merge PRs yourself.

## 1. Load the tasks

Load the Notion tools with ToolSearch if they're deferred. Query the Tasks data source with
`notion-query-data-sources` in `rows` mode, filtering `Status` `enum_is_not` `Done` (limit 100).
For specific ids, match on the `ID` property (number part of TUI-n, `auto_increment_id`).

## 2. Check the pull requests

Run `git fetch origin --prune` first. For every task with a `PR` url:

```bash
gh pr view <url> --json number,state,mergedAt,isDraft,baseRefName,headRefName,reviewDecision
```

| PR state | Status to set |
|---|---|
| `MERGED` into `main` | Candidate for Done; judge it in step 4 against `origin/main` |
| `MERGED` into another task branch (stacked) | Leave `In review`, noting "merged into stack, waiting for #N" |
| `OPEN` | `In review` (draft PRs too); note `CHANGES_REQUESTED` if present |
| `CLOSED` without merge | `In progress`, noting "PR #N closed unmerged"; ask whether to reopen or drop |

For a task with no `PR` but a `Branch`, check `gh pr list --head <branch>` and fill in `PR` if a
PR exists. Code that exists only on an unmerged branch is never Done.

## 3. Gather the evidence once

Judge against `origin/main`, not whatever branch is checked out. Don't switch branches; the
commander may be mid-task on a branch.

- **Routes on main:** `git grep -n "path: '" origin/main -- 'apps/api/src/modules/*/routes.ts'`
  together with the `method:` lines, or read files with `git show origin/main:<path>`. Handoff
  paths are relative to `/api/v1/orgs/{orgId}` unless they start with `/api/v1`, so normalise
  them before comparing. `{id}`-style params match any param name.
- **Tests on main:** read them the same way from `apps/api/test/` on `origin/main`.
- **Green:** if the current checkout is `main`, clean, and up to date with `origin/main`, run
  `pnpm typecheck` and `pnpm --filter @edustrux/api test`. Otherwise use the "Checks" section of
  each merged PR's description and its CI status (`gh pr checks <n>`, if CI exists), and say in
  the report that tests weren't re-run locally.

## 4. Judge each build task

For each task, check every Definition of Done item:

| Check | How |
|---|---|
| Merged | Step 2 says `MERGED` into `main` |
| Endpoints exist | Every path+method in `Endpoints` is in the routes on `origin/main` |
| Tests | Tests on main hit those paths, with cases for 400, another org's 404, a refused role's 403, and the audit log for writes |
| Green | Step 3 checks passed |
| Migration | If the task needs tables, they're in `packages/db/src/schema` and a migration exists |
| Design recorded | Deviations in the PR's "Design changes" are reflected in `docs/design/` |

Tasks with no `Endpoints` (infra, platform, tooling) are judged against their title and Notes by
reading the relevant code on `origin/main`.

- **All checks pass:** set `Status` to `Done`.
- **Merged but a check fails** (e.g. missing 403 tests): set `In progress`, and note what's
  missing so a follow-up PR can add it.
- **Not merged:** leave the status from step 2.
- **Code on main from before this workflow, with no PR** (the initial scaffold): judge it on the
  other checks alone.
- **Nothing exists:** leave it alone.
- **Locally run typecheck or tests failing on main:** mark nothing Done this run. Report the
  failures.

Never downgrade a `Done` task unless its code is clearly gone. Report that case instead of
changing it.

## 5. Decision and manual tasks

Decision tasks (`P0 Decisions`, module `decisions`) and manual ones (real Clerk run, legal,
launch) are never inferred from code. Mark them Done only with `--confirm`.

For a decision, its entry in `docs/design/decisions.md` must also be on `origin/main` (its docs PR
merged). If the entry is only in an open PR, set `In review`. If there's no entry at all, say so
and leave the task as it is.

## 6. Write and report

Update each changed task with `notion-update-page` (`update_properties`). You may set `Status`,
`Notes`, `PR` and `Branch`. Keep `Notes` short and factual, and don't touch other properties.

Return a short report:

```
Board sync: 3 → Done, 2 in review, 1 → In progress
Checks on main: typecheck ✓  tests ✓ (42 passed)   (or: "not re-run locally — from PR checks")

| Task | Was | Now | PR | Why |
|---|---|---|---|---|
| TUI-27 Branches and rooms CRUD | In review | Done | #12 merged | 8 endpoints, 11 tests on main |
| TUI-31 Courses | In review | In review | #14 open, changes requested | waiting on review |
| ... |

Needs attention: <PRs with requested changes, closed PRs, failing checks, merged work missing tests>
```
