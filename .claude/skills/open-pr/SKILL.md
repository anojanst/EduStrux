---
name: open-pr
description: Commit a finished EduStrux task on its branch, push it, and open a GitHub pull request with a generated review description, with the task file marked done in the same PR. Also updates an open PR after review feedback. Use when a task is implemented, or the user says "commit this", "open a PR", "raise a PR", or "push the fixes".
argument-hint: '<TUI-n> [TUI-n ...] [--report <implementation report>] [--draft] [--update]'
---

# Open PR

Every task reaches the user as one reviewable pull request. You commit the task's changes on its
branch, push, open the PR with a description the reviewer can act on, and link it on the board.
Read `CLAUDE.md` (Git workflow and Project tracking sections) first.

Arguments: `$ARGUMENTS`

- `TUI-n ...`: the task(s) this PR delivers.
- `--report`: the implementation report from `/implement-task`, used to write the description.
  Without it, work it out from the diff.
- `--draft`: open as a draft (use when checks fail and the user still wants it up).
- `--update`: the PR already exists. Commit the review fixes, push, and comment what changed.

## 1. Preconditions

```bash
git branch --show-current
git status --short
gh api user -q .login                                   # who Claude acts as
gh repo view --json owner -q .owner.login               # the reviewer
```

- **On `main`:** never commit there. Create the task branch first (naming in `CLAUDE.md`),
  carrying the working-tree changes with it.
- **Branch name doesn't match the task:** ask before continuing.
- **`gh` not authenticated, or no `origin` remote:** stop and tell the user. Don't create repos
  or remotes yourself.
- **Acting as the repo owner instead of the bot** (the two logins above match): the bot identity
  isn't set up, so the owner won't be able to approve or request changes on the PR. Warn the user
  once, mention `scripts/setup-claude-bot.sh` (see Identity in `CLAUDE.md`), then carry on. The
  PR still works for comments and merging.

## 2. Gate

```bash
pnpm typecheck
pnpm test
pnpm exec prettier --write <changed files>
```

If typecheck or tests fail, stop and report, unless `--draft` was given. A draft PR says plainly
in its description which checks fail.

## 3. Update the task files

Each task this PR delivers has a file, `docs/project/tasks/<phase>/tui-<n>-<slug>.md`. The PR
changes it, so merging the PR is what updates the board on `main`. Set:

- `status`:
  - `done` when the Definition of Done in `CLAUDE.md` holds for this PR. For a decision task, the
    decision must be in `docs/design/decisions.md`.
  - `in-progress` when it doesn't yet, e.g. a `--draft` with failing checks. Say what's missing
    in the notes.
  - `blocked` for a decision or manual task that still waits on the owner. Say on what.
- `branch`: the current branch.
- `pr`: left empty for now; step 8 fills it in once the PR exists.
- The notes (the body): fix anything this PR made stale, such as a "Missing: …" line it
  resolved, and add the D-numbers of decisions it recorded.

Don't run `pnpm board --check` yet. It rejects a `done` build task with a `branch` but no `pr`,
so it only passes once step 8 sets `pr`.

## 4. Choose what to commit

Read `git status --short` and `git diff`. Stage only this task's files, by path. Never
`git add -A` or `git add .`.

- **Belongs:** code, tests, migrations, shared schemas, `docs/design/*` changes for this task,
  the task files from step 3, and lockfile changes from dependencies the task added.
- **Never commit:** `.dev.vars`, `.seed-users.json`, `.wrangler/`, anything containing a key or
  token (`sk_live_`, `sk_test_` values, `-----BEGIN PRIVATE KEY`), or `node_modules`.
- **Unrelated changes already in the tree:** leave them unstaged and mention them in the report.
  If you can't tell whether a file belongs, ask.

Check the staged diff before committing:

```bash
git diff --cached --stat
git diff --cached | grep -nE 'sk_(live|test)_[A-Za-z0-9]{8,}|BEGIN (RSA )?PRIVATE KEY' && echo "SECRET FOUND"
```

## 5. Commit

Use one commit per task. For a bundle, use one commit per task when the changes separate
cleanly, otherwise one combined commit. With `--update`, add a new commit; never amend or
rebase a pushed commit unless the user asks.

```
<type>(<module>): <what the task delivers> (TUI-n)

<2–4 lines: what changed and why, in plain words>

Task: docs/project/tasks/<phase>/tui-<n>-<slug>.md   (one line per task in a bundle)
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

`<type>` is one of:

- `feat`: new endpoints or behaviour
- `fix`: a bug fix
- `docs`: decisions or design docs only
- `test`: tests only
- `refactor`: restructuring without behaviour change
- `chore`: tooling or config

Write the message to a file in the scratchpad and run `git commit -F <file>`, so the message
isn't mangled by shell quoting. Use the attribution line from the session's instructions if it
differs from the one above.

## 6. Push

```bash
git push -u origin <branch>
```

Never push to `main`, and never force-push. Both are blocked by the git hooks and Claude Code
deny rules (see "Protecting main" in `CLAUDE.md`). If the push is rejected, report it rather than
working around it. If a rebase is needed, ask the user to force-push.

## 7. Open the PR

**Base branch:** `main`. If the branch was stacked on another task's unmerged branch (the head
branch of an open PR, which `pnpm board` shows as in review), use that branch as the base, and say so at the
top of the description.

Write the description to a scratchpad file, then:

```bash
gh pr create --base <base> --head <branch> --title "<commit subject>" --body-file <file> \
  --reviewer <repo owner> [--draft]
```

Description template (drop sections that would be empty):

````markdown
## Summary

<2–3 sentences: what this delivers and why it matters for the product>

**Task:** [TUI-n <title>](docs/project/tasks/<phase>/tui-<n>-<slug>.md) · Phase <phase>
<"Stacked on #N — merge that first." if stacked>

## Changes

| Method | Path                          | Permission  |
| ------ | ----------------------------- | ----------- |
| POST   | /api/v1/orgs/{orgId}/branches | staff:write |

- **Tables:** `branches`, `rooms` — migration `0002_setup_branches.sql`
- **Shared schemas:** `Branch`, `CreateBranch`, …
- **Other:** <middleware, jobs, cron>

## Design changes

- D-0NN <title> — <one line> ([decisions.md](docs/design/decisions.md))
  <or "None — matches the handoff.">

## How to test

```bash
pnpm install && pnpm db:migrate && pnpm dev
pnpm dev:token owner      # paste into Swagger → Authorize at http://localhost:8787/api/docs
```

1. <concrete call with an example body, and what to expect>
2. With `pnpm dev:token teacher`: <call> → 403
3. With `pnpm dev:token owner_b`: <call with a Bright Minds id> → 404

## Checks

- [x] `pnpm typecheck`
- [x] `pnpm test` — <N> passed (<M> new)
- [x] Migration generated
- [x] Design docs updated
- [ ] Tried in Swagger by reviewer

## Review focus

- <the 1–3 places where a mistake would hurt most: money maths, scoping, a migration>

## Follow-ups

- <deferred items, TODOs, related tasks>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

Request the repo owner as reviewer (drop `--reviewer` when acting as the owner, since GitHub
won't let authors review their own PRs). Make "How to test" specific to this task, with real paths and example bodies. A reviewer
should be able to follow it without reading the code.

## 8. Link it

- Set `pr: <N>` in each task file and run `pnpm -s board --check`. Fix anything it reports, then
  commit the task files as `chore(board): link PR #N (TUI-n)`, with the same `Task:` and
  attribution lines, and push. The PR is squash-merged, so this adds no noise to `main`.
- If this session has the `ccd_pr` tools, call `get_status`, and `bind_pr` if it doesn't report
  this PR. Don't poll CI.
- With `--update`, post a PR comment listing what changed (`gh pr comment <n> --body-file <file>`),
  and change the task file only if its status changes (e.g. a draft whose checks now pass
  becomes `done`).

Never merge the PR. The user reviews and merges, and merging makes the task done on `main`.

## 9. Report

```
PR #12 opened: <url>
Branch task/tui-27-branches-rooms → main · 1 commit · 14 files
Checks: typecheck ✓ tests ✓ (48 passed, 14 new)
Board: TUI-27 → done in this PR (shows as in review until merged)
Left unstaged: <files, or none>
```
