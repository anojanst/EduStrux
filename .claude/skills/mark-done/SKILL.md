---
name: mark-done
description: Check the EduStrux board (docs/project/tasks) against what is actually built and merged, using the repo and GitHub PR states. Tidies merged branches and, when statuses have drifted or the user confirms a manual task, opens a small chore/board PR to fix the task files. Use after merges, when the user says a task is finished, or to sync the board ("mark done", "update the tickets", "sync the board").
argument-hint: '[TUI-n ...] [--sync] [--confirm TUI-n] [--report-only]'
context: fork
agent: general-purpose
background: false
---

# Mark done

You keep the board honest. The board is the task files in `docs/project/tasks/` on `main`. Read
`CLAUDE.md` (Project tracking, Definition of Done) and `docs/project/README.md` first.

Arguments: `$ARGUMENTS`

- `TUI-12 TUI-14`: check just these tasks.
- `--sync` (or no arguments): check every task that isn't `done` or `deferred`, every task whose
  live state is `merged`, and any `todo` task whose endpoints already exist on `main`.
- `--confirm TUI-n`: the user says this manual or decision task is finished (e.g. the domain is
  registered). Mark it `done` after the checks in step 5.
- `--report-only`: report what should change, but don't open a PR.

**How statuses normally change:** a task's own PR sets its file to `done` (with `branch` and
`pr`), so merging the PR updates `main`. You only fix what that misses: a task the owner confirms
by hand, merged work whose file wasn't updated, code on `main` that the board doesn't know about,
or a closed PR. Never merge PRs yourself.

## 1. Load the board

Run `git fetch origin --prune`, then `pnpm -s board --all --json`. Read the task files as they
are on `origin/main`: if the checkout isn't `main`, use
`git show origin/main:docs/project/tasks/<folder>/<file>` for the tasks you judge. Each task has
its file fields plus a `live` field (`in-progress` from a local branch, `in-review` from an open
PR, `merged` when its `pr` merged but the file isn't `done`).

## 2. Check the pull requests

For every task with a `pr`, a `branch`, or a `live` state:

```bash
gh pr view <n> --json number,state,mergedAt,isDraft,baseRefName,headRefName,reviewDecision
```

| PR state                                    | What it means                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MERGED` into `main`                        | The file on `main` should already be `done` (or `in-progress` with notes). If not, judge it in step 4                                                                |
| `MERGED` into another task branch (stacked) | Waiting for the base PR; nothing to change                                                                                                                           |
| `OPEN`                                      | In review (draft PRs too). Note `APPROVED` or `CHANGES_REQUESTED`. If the PR author is the owner, `reviewDecision` stays empty, so read the owner's comments instead |
| `CLOSED` without merge                      | The file on `main` never changed. Report "PR #N closed unmerged" and ask whether to reopen or drop                                                                   |

Code that exists only on an unmerged branch is never done.

### Clean up merged branches

Branches are deleted once their PR is merged. GitHub deletes the remote branch itself (the repo
has "Automatically delete head branches" on), and the earlier `git fetch --prune` drops its
remote-tracking ref. You tidy up what's left, for every PR that is `MERGED`:

1. **Local branch.** If `git branch --list <headRefName>` finds it, delete it with
   `git branch -d <headRefName>`, but never the branch that's checked out. If `-d` refuses because
   of unmerged commits (normal after a squash or rebase merge), check
   `git log origin/main..<branch>`. Use `-D` only if every commit there is in the merged PR
   (`gh pr view <n> --json commits`). Otherwise keep the branch and report it, because it has work
   that never shipped.
2. **Remote branch, as a fallback** (if `git ls-remote --heads origin <headRefName>` still finds
   it):
   - First retarget any open PR stacked on it: `gh pr list --base <headRefName>`, then
     `gh pr edit <n> --base main` for each. Deleting a base branch would otherwise close those PRs.
   - Then `git push origin --delete <headRefName>`.
3. Never delete `main`, a branch whose PR is open or closed-unmerged, or a branch with no PR.
4. Leave the task file's `branch` as it is; it's the record of where the work was done.

List the deleted branches in the report.

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

## 4. Judge each task

For each build task whose file on `main` isn't `done` but might be (live `merged`, endpoints on
`main`, or named in the arguments), check every Definition of Done item:

| Check           | How                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Merged          | Step 2 says `MERGED` into `main`, or the code is on `main` from before this workflow                                     |
| Endpoints exist | Every path+method in `endpoints` is in the routes on `origin/main`                                                       |
| Tests           | Tests on main hit those paths, with cases for 400, another org's 404, a refused role's 403, and the audit log for writes |
| Green           | Step 3 checks passed                                                                                                     |
| Migration       | If the task needs tables, they're in `packages/db/src/schema` and a migration exists                                     |
| Design recorded | Deviations in the PR's "Design changes" are reflected in `docs/design/`                                                  |

Tasks with no `endpoints` (infra, platform, tooling) are judged against their title and notes by
reading the relevant code on `origin/main`.

- **All checks pass:** the file should be `done`.
- **Merged but a check fails** (e.g. missing 403 tests): the file should be `in-progress`, with
  what's missing in the notes so a follow-up PR can add it.
- **Nothing exists:** leave it alone.
- **Locally run typecheck or tests failing on main:** change nothing this run. Report the
  failures.

Never downgrade a `done` task unless its code is clearly gone. Report that case instead of
changing it.

## 5. Decision and manual tasks

Decision tasks (phase `P0`, module `decisions`) and manual ones (real Clerk run, legal, launch,
registering the domain) are never inferred from code. Their docs PR usually marks them; otherwise
mark them `done` only with `--confirm`.

For a decision, its entry in `docs/design/decisions.md` must be on `origin/main`. If the entry is
only in an open PR, nothing changes yet. If there's no entry at all, say so and leave the task.

## 6. Fix the files (skip with `--report-only`, or if nothing needs changing)

Status fixes go to `main` through a small PR, like everything else. Don't switch the main
checkout's branch (the commander may be mid-task); use a separate worktree:

```bash
git worktree add -b chore/board-sync-<yyyy-mm-dd> ../edustrux-board-sync origin/main
```

In the worktree, edit only the task files that need it: `status`, `branch`, `pr` and the notes.
Keep notes short and factual. Run `node scripts/board.mjs --check` there. Commit with
`chore(board): sync statuses (TUI-n, …)` and the attribution line, push, and open the PR with
`gh pr create --base main` and a body that lists each change and why (the table from the report).
Then remove the worktree (`git worktree remove ../edustrux-board-sync`). Never push to `main`.

## 7. Report

```
Board sync: 2 tasks fixed in PR #15, 3 in review, main green
Checks on main: typecheck ✓  tests ✓ (42 passed)   (or: "not re-run locally — from PR checks")

| Task | File on main | Should be | PR | Why |
|---|---|---|---|---|
| TUI-88 Dev token script | in-progress | done | — | owner confirmed (--confirm) |
| TUI-31 Courses | todo | todo (in review) | #14 open, changes requested | waiting on review |
| ... |

Board fix PR: #15 https://github.com/anojanst/EduStrux/pull/15   (or: none needed)
Branches deleted: task/tui-27-branches-rooms (local)   (or: none)
Needs attention: <PRs with requested changes, closed PRs, failing checks, merged work missing tests, branches kept with unshipped commits>
```
