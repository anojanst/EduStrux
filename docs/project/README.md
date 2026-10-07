# EduStrux project board

The build is tracked here, in git, as one markdown file per task. This replaced the Notion board
on 2026-10-07 (D-029). The old Notion workspace is an archive and is no longer updated.

- Product and technical design: [handoff.md](../design/handoff.md)
- Decisions made during the build: [decisions.md](../design/decisions.md)
- Workflow, Definition of Done and git rules: [CLAUDE.md](../../CLAUDE.md)

## Goal

- First-year target: **NZ$500/month profit**, about US$281, which is about **26–30 centres** at a
  4:1 Solo:Small mix.
- Plans: Solo US$9.90/month (up to 30 students), Small US$24.90/month (up to 150 students), Talk
  to us. Annual: Solo US$99/year, Small US$249/year (two months free, D-027).

## Phases

| Phase                 | Folder                       | What                                                                                                      |
| --------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| P0 Decisions          | `tasks/p0-decisions/`        | Open product and technical questions                                                                      |
| P1 Foundation         | `tasks/p1-foundation/`       | Monorepo, Drizzle/D1, auth and org middleware, conventions                                                |
| P2 Vertical slice     | `tasks/p2-vertical-slice/`   | Onboarding → setup → classes → sessions → families → enrolment → attendance → invoices → payment → portal |
| P3 Core modules       | `tasks/p3-core-modules/`     | The rest of the MVP, module by module                                                                     |
| P4 Background & comms | `tasks/p4-background-comms/` | Queues, Resend, cron, webhooks                                                                            |
| P5 SaaS layer         | `tasks/p5-saas-layer/`       | Paddle billing, plan limits, super-admin                                                                  |
| P6 Launch hardening   | `tasks/p6-launch-hardening/` | Security, export, privacy, E2E tests, deploy                                                              |
| P7 UI                 | `tasks/p7-ui/`               | The web app, built on the finished API (API-first, D-001)                                                 |

v1.1, Later and paid add-on features (WhatsApp, SMS, AI) are listed in handoff §8 and aren't on
the board. Tasks cut from the MVP stay on the board as `deferred` (D-022).

## See the board

```bash
pnpm board                  # open tasks by phase, with live branch and PR state
pnpm board --all            # include done and deferred
pnpm board --phase P2       # one phase; also --module billing, --status todo
pnpm board --json           # every task as JSON
pnpm board --check          # validate the task files
```

`pnpm board` reads the task files, then adds what's happening now: a local branch for a task shows
it as _in progress_, and an open pull request shows it as _in review_. It uses `gh` for PR state
and still works without it (`--offline`).

## A task file

`tasks/<phase folder>/tui-<n>-<slug>.md`, for example
[`tasks/p2-vertical-slice/tui-27-branches-and-rooms.md`](tasks/p2-vertical-slice/tui-27-branches-and-rooms.md):

```markdown
---
id: TUI-27
title: Branches and rooms CRUD
status: todo
phase: P2
module: orgs
priority: P0
size: S
endpoints:
  - GET|POST /branches
  - PATCH|DELETE /branches/{id}
branch:
pr:
---

# TUI-27 Branches and rooms CRUD

Room capacity. Hide branches in single-tutor mode.
```

| Field       | Values                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `TUI-<n>`. New tasks take the next number (`pnpm board` prints it). Never reuse a number.                                                                                        |
| `title`     | Short task name. Quote it if it contains `: `.                                                                                                                                   |
| `status`    | `todo` · `in-progress` · `blocked` · `done` · `deferred` (see below)                                                                                                             |
| `phase`     | `P0`–`P7`. Must match the folder.                                                                                                                                                |
| `module`    | `decisions` · `infra` · `platform` · `orgs` · `people` · `curriculum` · `classes` · `enrolment` · `attendance` · `learning` · `billing` · `comms` · `portal` · `reports` · `web` |
| `priority`  | `P0` Must · `P1` Should · `P2` Could                                                                                                                                             |
| `size`      | `S` · `M` · `L`                                                                                                                                                                  |
| `endpoints` | API routes the task delivers, or `[]`. Paths are relative to `/api/v1/orgs/{orgId}` unless they start with `/api/v1`.                                                            |
| `branch`    | The git branch the work was done on (kept after merge, as history)                                                                                                               |
| `pr`        | The pull request number                                                                                                                                                          |

The body holds the notes: scope, rules, links to decisions, what's missing. Keep it short and
factual.

## Statuses and the lifecycle

| Status        | Means                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `todo`        | Not started                                                                                                                             |
| `in-progress` | Partly built **on `main`** (e.g. code merged but tests missing). Work on a branch shows as in progress live, without changing the file. |
| `blocked`     | Waiting on something outside the code, usually the owner (say what in the notes)                                                        |
| `done`        | Meets the Definition of Done in `CLAUDE.md`, and its PR is merged                                                                       |
| `deferred`    | Moved out of the MVP (to v1.1 or later)                                                                                                 |

A task's own pull request changes its file, so **`main` always shows what's merged**:

1. **Start:** create the task branch (`task/tui-<n>-<slug>`). `pnpm board` now shows the task as
   in progress. Nothing changes in `main`.
2. **Open the PR:** the PR's commits set the file to `status: done` with `branch` and `pr`
   filled in. The board shows the task as in review while the PR is open.
3. **Merge:** merging the PR makes the task done on `main`. If review sends work back, the file
   stays as it is on the branch until the PR is merged or closed.
4. **Partial work:** if a PR merges with Definition of Done items still missing, its file says
   `in-progress` and the notes list what's missing.

Status changes that don't come from a task's own PR (a task the owner confirms by hand, deferring
tasks, fixing drift) go in a small `chore/board-<slug>` PR, which `/mark-done` prepares.

## Adding or changing tasks

- **New task:** add a file in the right phase folder with the next id, then run
  `pnpm board --check`. Ship it with the work that needs it, or in a `chore/board-<slug>` PR.
- **Moving phases:** `git mv` the file to the new folder and change `phase`.
- **Never delete a task file.** Use `deferred` and say why in the notes.
