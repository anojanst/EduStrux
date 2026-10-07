# EduStrux

SaaS for tuition centres (solo tutor → multi-branch). Built **API-first**: the whole MVP API is
built and tested through Swagger (phases P1–P6) before the web app (P7 UI).

- Layout, commands and code conventions: [README.md](README.md)
- Product and technical design (living spec): [docs/design/handoff.md](docs/design/handoff.md)
- Decisions made during the build: [docs/design/decisions.md](docs/design/decisions.md)

## Project tracking (Notion)

| What              | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Project page      | https://app.notion.com/p/3f0b1cfeccf781ac9191c65fa90efd10 (page id `3f0b1cfeccf781ac9191c65fa90efd10`) |
| Tasks database    | https://app.notion.com/p/548605a808a74c9eadccc138392457a1                                              |
| Tasks data source | `collection://9fac3feb-0aae-44c1-a78b-7f5bafaceb1b`                                                    |

Tasks properties (exact names): `Task` (title), `ID` (TUI-n, read-only), `Status`
(`Not started` · `In progress` · `In review` · `Blocked` · `Done`), `Phase` (`P0 Decisions` ·
`P1 Foundation` · `P2 Vertical slice` · `P3 Core modules` · `P4 Background & comms` ·
`P5 SaaS layer` · `P6 Launch hardening` · `P7 UI`), `Module`, `Priority` (`P0 Must` ·
`P1 Should` · `P2 Could`), `Size` (`S` · `M` · `L`), `Endpoints`, `Notes`, `PR` (url),
`Branch`.

Status lifecycle: `Not started` → `In progress` (task branch created) → `In review` (PR open)
→ `Done` (PR merged and the Definition of Done holds on `main`).

The Notion tools are MCP tools named `notion-*` (load them with ToolSearch if they are deferred).
Read tasks with `notion-query-data-sources` in `rows` mode (works on every Notion plan; max 100
rows, so filter out `Done`), and write with `notion-update-page` → `update_properties`.

## Definition of Done

A build task is **Done** only when all of these hold:

1. Every endpoint in its `Endpoints` field is implemented and appears in `/api/openapi.json`.
2. Tests in `apps/api/test/` cover the happy path, validation (400), another org's ids (404),
   each role that must be refused (403), and the audit row for writes.
3. `pnpm typecheck` and `pnpm test` pass.
4. Schema changes have a generated migration in `packages/db/migrations/`.
5. Anything that deviated from or added to the design is recorded in `docs/design/`.
6. The work is in a pull request linked on the task (`PR`), and the user has merged it.

Decision tasks (`P0 Decisions`, module `decisions`) are Done only when the user has stated the
decision and it is logged in `docs/design/decisions.md`. Tasks that need a person (running
against real Clerk, legal docs, launch) are Done only when the user confirms them.

## Skills

| Skill                 | Does                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `/commander`          | Runs the loop below, choosing which skills to run and in what order                                  |
| `/mark-done`          | Checks the board against the repo and updates task statuses (subagent)                               |
| `/recommend-next`     | Recommends the next task(s) to build, read-only (subagent)                                           |
| `/implement-task`     | Builds one task, or a small bundle, to the Definition of Done on its own branch                      |
| `/update-design-docs` | Brings `docs/design/` and the Notion project page in line with what was built or decided (subagent)  |
| `/open-pr`            | Commits the task, pushes, opens a PR with a generated review description, sets the task to In review |

Typical loop: mark-done (sync) → recommend-next → implement-task → update-design-docs → open-pr.
After the user merges, the next sync moves the task to Done.

## Git workflow

Every task (or small bundle) is delivered as its own pull request for the user to review.

- **Branch per task**, created from an up-to-date `main` before any code changes:
  `task/tui-<n>-<short-slug>` (bundle: `task/tui-<n>-<m>-<slug>`). Decisions recorded without code
  use `docs/tui-<n>-<slug>`. Changes not tied to a task use `chore/<slug>`.
- **Stacking:** if a task needs code from another task whose PR isn't merged yet, branch from
  that task's branch and target its PR at that branch ("Stacked on #N").
- **Commits:** `<type>(<module>): <summary> (TUI-n)`, ending with the Notion link and the
  attribution line. Stage files by path. Never commit `.dev.vars`, `.seed-users.json` or secrets.
- **Pushing and PRs** on task branches are expected as part of this workflow. Never push to
  `main`, merge a PR, force-push or deploy. The user reviews and merges. If a branch needs a
  rebase and force-push, ask the user to run it.
- **Review feedback:** fix on the same branch as new commits (`/open-pr --update`). Don't amend
  pushed commits.
- **Merged branches are deleted.** GitHub deletes the remote branch on merge (repo setting
  "Automatically delete head branches", which also retargets stacked PRs). `/mark-done` deletes
  the matching local branches on the next sync. Notion's `Branch` property keeps the name for
  history.

### Identity: Claude acts as a bot account

GitHub doesn't let a PR's author approve or request changes on it. So Claude commits, pushes and
opens PRs as a separate **bot** GitHub account with write (not admin) access, and the owner
reviews as themselves.

- **Set up once by the owner:** run `scripts/setup-claude-bot.sh <bot-username>`. It writes
  `GH_TOKEN` and the bot's git author/committer to `.claude/settings.local.json` (gitignored). Only
  Claude Code sessions use that identity; the owner's own terminal is unaffected.
- **Never read, print or edit** `.claude/settings.local.json` or `GH_TOKEN`. Deny rules block it.
- `/open-pr` requests the owner's review. If `gh api user` returns the owner, the bot isn't set
  up: PRs still work, but the owner can only comment and merge.

### Protecting main

`main` changes only through merged pull requests. Three layers enforce this:

| Layer                  | Blocks                                                                                                                                             | Where                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Git hooks              | Commits on `main`; pushing to, force-pushing or deleting `main`                                                                                    | `.githooks/` (installed by `pnpm install` via `core.hooksPath`)           |
| Claude Code deny rules | Claude pushing to `main`, force-pushing, `--no-verify`, changing the hooks path, merging PRs                                                       | `.claude/settings.json`                                                   |
| GitHub ruleset         | Everyone: PR with 1 approval required (admins may bypass approval on a PR, never direct pushes), no force-push or deletion, conversations resolved | `.github/rulesets/protect-main.json`, active on GitHub (ruleset 24489131) |

Don't try to work around a block (another flag, `git -c`, the API). Stop and tell the user.
