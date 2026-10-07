---
name: commander
description: Drive the EduStrux build. Syncs the Notion board, picks the next task, implements it on its own branch, updates the design docs and opens a pull request for review, running /mark-done, /recommend-next, /implement-task, /update-design-docs and /open-pr in whatever order the situation needs. Use when the user says "keep building", "next task", "run the commander", "status", or gives a goal without naming a single step.
argument-hint: '[TUI-n | status | sync | decide | review | --count N | --auto]'
---

# Commander

You run the build loop by calling the worker skills through the Skill tool. You decide the order,
pass each one's output to the next, and keep the user informed. Every task you build ends as one
pull request for the user to review. Read `CLAUDE.md` first, especially the Git workflow.

| Worker               | Runs as           | Use it to                                                    |
| -------------------- | ----------------- | ------------------------------------------------------------ |
| `mark-done`          | subagent          | sync the board with `main` and GitHub; Done only after merge |
| `recommend-next`     | subagent          | choose what to build (read-only)                             |
| `implement-task`     | this conversation | create the task branch and build to the Definition of Done   |
| `update-design-docs` | subagent          | record design changes and decisions (on the task branch)     |
| `open-pr`            | this conversation | commit, push, open the PR, set the task to In review         |

Arguments: `$ARGUMENTS`

| Input            | Plan                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| _(none)_         | Full loop, once: sync → recommend → confirm → implement → docs → PR                        |
| `TUI-n [TUI-n…]` | Skip the recommendation: sync → implement those → docs → PR                                |
| `status`         | sync → recommend. Report only; build nothing.                                              |
| `sync`           | mark-done only                                                                             |
| `review`         | Address review feedback on open PRs (see below)                                            |
| `decide`         | Work through open decision tasks with the user → docs → docs PR → mark done after merge    |
| `--count N`      | Repeat the full loop up to N times, one PR per task                                        |
| `--auto`         | Don't ask before implementing the recommended task. Still ask about real design decisions. |

A free-text goal ("finish billing", "record that we chose X") maps onto the closest plan: pass
`--module` to recommend-next, or send a decision to update-design-docs and then open-pr.

## The loop

### 1. Preflight

- Run `git status --short` and `git branch --show-current`.
  - If there are **uncommitted changes**, find out whose they are before anything else. If they're
    an unfinished task (the branch matches a task), offer to finish it: tests, then `open-pr`.
    Otherwise ask the user whether to ship them as a `chore/` PR, stash them, or stop. Never
    discard them.
  - If you're **on a task branch with nothing uncommitted**, switch to `main`
    (`git switch main && git pull --ff-only`).
- Load the Notion tools with ToolSearch if they're deferred. Check `gh auth status`.

### 2. Sync — `Skill(mark-done, "--sync")`

This moves merged PRs to Done and records PR states. If it reports failing typecheck or tests on
`main`, **stop the loop**. Offer to fix them first (as their own `fix/` PR), because building on a
red baseline hides new breakage.

### 3. Choose — `Skill(recommend-next, ...)`

Skip this when the user named tasks.

- If an open PR has **changes requested**, do the `review` flow below for it before new work.
- If it reports **blocking decisions**, ask the user with AskUserQuestion: one question per
  decision, with options taken from the handoff, recommended option first. Record the answers
  with the `decide` flow, then ask recommend-next again.
- If it warns the **review queue is long** (3+ open PRs), tell the user. With `--count`, stop
  after the current task instead of piling up more PRs.

### 4. Confirm (skip with `--auto` or named tasks)

Ask once with AskUserQuestion: the recommendation (Recommended), the two alternatives, and
"Stop here". Show each task's scope and its base branch (main or stacked) in the option
description.

### 5. Build — `Skill(implement-task, "TUI-n ... --no-ship")`

It creates the task branch (from `main`, or stacked as recommended), sets the task to In
progress, builds, runs typecheck and tests, and ends with an implementation report.

- If it stops on a design question, ask the user, then continue the same task.
- If tests stay red after a genuine fix attempt, stop. Leave the work on the branch,
  uncommitted, with the task In progress, and report what's failing. Offer a draft PR
  (`open-pr --draft`) so the user can look at it.

### 6. Record — `Skill(update-design-docs, "<implementation report>")`

Always run this after a build. New endpoints and tables update §9 and §7 even when nothing
deviated. Its edits stay on the task branch, so they ship in the same PR.

### 7. Ship — `Skill(open-pr, "TUI-n ... --report <implementation report + docs summary>")`

This commits, pushes, opens the PR with the generated description, and sets the task to In
review with the PR link. Don't call mark-done for the task now; it becomes Done when the user
merges, at the next sync.

### 8. Repeat

With `--count N`: go back to `main` (`git switch main`), then return to step 3. The next task
either starts from `main` or is stacked on the branch just pushed if it depends on it, as
recommend-next advises. Don't re-sync between rounds. Stop early on any red result, any
unanswered question, a long review queue, or when the only remaining work needs a decision.

## `review` flow (feedback on a PR)

1. `gh pr list` (and `gh pr view <n> --comments`, plus `gh api repos/{owner}/{repo}/pulls/<n>/comments`
   for inline comments). Pick the PRs with `reviewDecision: CHANGES_REQUESTED`, or with comments
   from the repo owner that have no reply or follow-up commit yet. When PRs are authored by the
   owner (no bot identity), comments are the only review signal.
2. `git switch <head branch>` and `git pull`. Make the fixes, keeping the conventions from
   implement-task. Run typecheck and tests.
3. If a fix changes the design, run `Skill(update-design-docs, ...)`.
4. `Skill(open-pr, "TUI-n --update")` pushes a new commit and comments what changed.
5. Switch back to `main`.

## `decide` flow (decisions)

1. Ask the user the open decision questions (AskUserQuestion, recommended option first).
2. Create a docs branch from `main`: `git switch -c docs/tui-<n>-<slug>`.
3. `Skill(update-design-docs, "<decisions>")`, then `Skill(open-pr, "TUI-n …")`, which opens a
   docs-only PR.
4. The decision tasks go to In review. They become Done once the PR is merged (mark-done checks
   that the decision entry is on `main`).

## Rules

- Workers do the work. Don't do their jobs inline (e.g. editing Notion statuses or writing PR
  bodies yourself).
- Pass context forward explicitly: subagents start cold, so give them task ids and the previous
  step's report.
- One task (or one small bundle from recommend-next) per PR. Never mix tasks into another task's
  PR.
- Never push to `main`, merge PRs, or deploy. The user reviews and merges.
- Keep the user posted with one line per step ("Board synced: 2 → Done. Recommending next…").

## Final report

```
## Commander run
| Step | Result |
|---|---|
| Sync | 2 → Done (PRs #9, #10 merged), 1 in review |
| Picked | TUI-27 Branches and rooms CRUD (+ TUI-28) — base main |
| Built | 9 endpoints, 2 tables, 14 tests — typecheck ✓ tests ✓ |
| Docs | D-012 added; handoff §7, §9 updated |
| PR | #12 https://github.com/anojanst/EduStrux/pull/12 — TUI-27, TUI-28 → In review |

Waiting on your review: #11, #12
Next up: TUI-31 Courses (subject × grade) — needs #12 merged first, or I can stack it
Decisions waiting on you: <list or none>
```
