---
name: update-design-docs
description: Keep EduStrux's design docs (docs/design/handoff.md, docs/design/decisions.md) and the Notion project page in line with what was built or decided. Use after implementing a task, when the user makes a product or technical decision, or when they say "update the design docs" or "record this decision".
argument-hint: '[implementation report | decision text | --from-diff]'
context: fork
agent: general-purpose
background: false
---

# Update design docs

You keep the design docs true to the code and to the user's decisions. Read `CLAUDE.md` first.

Arguments: `$ARGUMENTS` — one of:

- an implementation report from `/implement-task` (its "Design changes" list, endpoints, tables)
- a decision the user stated ("parents sign in with our own magic links")
- `--from-diff`: work out what changed from `git diff` and `git status` yourself

## The documents

| Doc                                                      | What it's for                                             | How to edit                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/decisions.md`                               | Every decision made during the build                      | Append only. Next number `D-NNN`. A changed decision gets a new entry, and the old one gets "**Superseded by D-xxx**" added under its title. |
| `docs/design/handoff.md`                                 | The living spec: what the product does and how it's built | Smallest edit that makes it true. Cite `(D-xxx)` where a decision changed it. Update the `Last updated:` date.                               |
| Notion project page (`3f0b1cfeccf781ac9191c65fa90efd10`) | One-page overview: goal, stack, phases                    | Only when the stack, phases or goal change. Fetch first, then make a targeted `update_content` edit.                                         |
| `README.md` Conventions                                  | How to write code here                                    | Only when a coding convention changes                                                                                                        |

## What goes where

- **New or changed endpoints:** handoff §9. Fix the path, method or note to match the code. Mark
  endpoints that were added beyond the original list with `(added, D-xxx)`.
- **New tables or meaningful columns:** handoff §7 (key columns only, not every field).
- **Permissions that differ from the plan:** handoff §6, plus a decision entry.
- **Conventions** (errors, paging, money, dates): handoff §5, and README if it affects code.
- **Answered open questions:** in handoff §11, tick the box and add the answer and decision id,
  e.g. `- [x] Parent sign-in: own magic-link tokens (D-014)`. Don't delete the question.
- **Scope moved** (MVP ↔ v1.1): handoff §8, plus a decision entry.
- **Code-level detail** (file names, helper functions) belongs in code and README, not here.

## Decision entry format

```markdown
## D-0NN · YYYY-MM-DD · Short title

- **Context:** why this came up (one or two lines)
- **Decision:** what was decided
- **Consequences:** what it changes or rules out
- **Tasks:** TUI-n, ...
```

Use today's date. Only record a decision the user actually made, or one the implementation
already made and reported. Never invent rationale. Mark anything you're unsure of as an
assumption.

## Steps

1. Read the input. With `--from-diff`, read the diff of `packages/db/src/schema`,
   `packages/shared/src/schemas`, `packages/shared/src/permissions.ts` and
   `apps/api/src/modules/*/routes.ts`.
2. Read the relevant handoff sections and the last few decision entries.
3. Make the edits. Keep the handoff's style: short sentences, tables, no marketing.
4. If a decision answers a decision task on the Notion board, say so in your report. Don't update
   the board yourself; the caller runs `/mark-done --confirm TUI-n`.
5. Don't commit. Your edits stay in the working tree on the current branch: a task branch puts
   them in that task's PR. If you're on `main` (a decision recorded on its own), say so in the
   report. The caller then ships them with `/open-pr` on a `docs/tui-<n>-<slug>` branch.

## Report

```
Design docs updated
- decisions.md: + D-014 Parent sign-in uses own magic-link tokens
- handoff.md: §11 ticked parent sign-in; §9 portal auth note; Last updated → 2026-10-12
- Notion project page: no change
Board follow-up: /mark-done --confirm TUI-4
Branch: task/tui-27-branches-rooms (edits will ship in its PR)   or: main — ship with /open-pr
```

If nothing needed changing, say so in one line.
