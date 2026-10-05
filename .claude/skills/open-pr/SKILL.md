---
name: open-pr
description: Commit a finished EduStrux task on its branch, push it, and open a GitHub pull request with a generated review description, then set the Notion task to In review. Also updates an open PR after review feedback. Use when a task is implemented, or the user says "commit this", "open a PR", "raise a PR", or "push the fixes".
argument-hint: "<TUI-n> [TUI-n ...] [--report <implementation report>] [--draft] [--update]"
---

# Open PR

Every task reaches the user as one reviewable pull request. You commit the task's changes on its
branch, push, open the PR with a description the reviewer can act on, and link it on the board.
Read `CLAUDE.md` (Git workflow and Notion sections) first.

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
gh auth status
```

- **On `main`:** never commit there. Create the task branch first (naming in `CLAUDE.md`),
  carrying the working-tree changes with it.
- **Branch name doesn't match the task:** ask before continuing.
- **`gh` not authenticated, or no `origin` remote:** stop and tell the user. Don't create repos
  or remotes yourself.

## 2. Gate

```bash
pnpm typecheck
pnpm test
pnpm exec prettier --write <changed files>
```

If typecheck or tests fail, stop and report, unless `--draft` was given. A draft PR says plainly
in its description which checks fail.

## 3. Choose what to commit

Read `git status --short` and `git diff`. Stage only this task's files, by path. Never
`git add -A` or `git add .`.

- **Belongs:** code, tests, migrations, shared schemas, `docs/design/*` changes for this task, and
  lockfile changes from dependencies the task added.
- **Never commit:** `.dev.vars`, `.seed-users.json`, `.wrangler/`, anything containing a key or
  token (`sk_live_`, `sk_test_` values, `-----BEGIN PRIVATE KEY`), or `node_modules`.
- **Unrelated changes already in the tree:** leave them unstaged and mention them in the report.
  If you can't tell whether a file belongs, ask.

Check the staged diff before committing:

```bash
git diff --cached --stat
git diff --cached | grep -nE 'sk_(live|test)_[A-Za-z0-9]{8,}|BEGIN (RSA )?PRIVATE KEY' && echo "SECRET FOUND"
```

## 4. Commit

Use one commit per task. For a bundle, use one commit per task when the changes separate
cleanly, otherwise one combined commit. With `--update`, add a new commit; never amend or
rebase a pushed commit unless the user asks.

```
<type>(<module>): <what the task delivers> (TUI-n)

<2–4 lines: what changed and why, in plain words>

Notion: <task page url>
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

## 5. Push

```bash
git push -u origin <branch>
```

Never push to `main`. Never force-push, except `--force-with-lease` on your own task branch after
a rebase the user asked for.

## 6. Open the PR

**Base branch:** `main`. If the branch was stacked on another task's unmerged branch (the
Notion `Branch` of a task that is `In review`), use that branch as the base, and say so at the
top of the description.

Write the description to a scratchpad file, then:

```bash
gh pr create --base <base> --head <branch> --title "<commit subject>" --body-file <file> [--draft]
```

Description template (drop sections that would be empty):

````markdown
## Summary
<2–3 sentences: what this delivers and why it matters for the product>

**Task:** [TUI-n <title>](<notion url>) · Phase <phase>
<"Stacked on #N — merge that first." if stacked>

## Changes
| Method | Path | Permission |
|---|---|---|
| POST | /api/v1/orgs/{orgId}/branches | staff:write |

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

Make "How to test" specific to this task, with real paths and example bodies. A reviewer
should be able to follow it without reading the code.

## 7. Link it

- On Notion (`notion-update-page`, `update_properties`), set `Status` → `In review`, `PR` → the
  PR url, `Branch` → the branch name, and add "PR #N opened" to `Notes`.
- If this session has the `ccd_pr` tools, call `get_status`, and `bind_pr` if it doesn't report
  this PR. Don't poll CI.
- With `--update`, post a PR comment listing what changed (`gh pr comment <n> --body-file <file>`),
  and leave the Notion status as `In review`.

Never merge the PR. The user reviews and merges, and `/mark-done` moves the task to Done after
the merge.

## 8. Report

```
PR #12 opened: <url>
Branch task/tui-27-branches-rooms → main · 1 commit · 14 files
Checks: typecheck ✓ tests ✓ (48 passed, 14 new)
Notion: TUI-27 → In review
Left unstaged: <files, or none>
```
