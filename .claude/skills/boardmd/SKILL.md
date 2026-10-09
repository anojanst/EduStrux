---
name: boardmd
description: Read, create and update this repo's tasks (markdown files in docs/project/tasks/, shown as a board by board.md). Use when the user asks to add or file a task, change a task's status, branch or PR, find or list tasks, or check the task files.
---

<!-- Written by boardmd. Run "pnpm boardmd guide --install --force" to rewrite it. -->

# Tasks with boardmd

1. Run `pnpm boardmd guide` and follow it. It has this repo's fields, allowed values and rules.
2. Read tasks with `pnpm boardmd list --json` (add `--all` for finished ones) or `pnpm boardmd show <id>`.
3. Create a task with `pnpm boardmd new "<title>" --set <field>=<value> …`. If it reports a missing
   field, infer it from similar tasks or ask the user, then run it again.
4. Change fields with `pnpm boardmd set <id> <field>=<value> …` (status, branch, pr, …). Edit the
   notes, the markdown body, directly.
5. Run `pnpm boardmd check` after any change, and fix what it reports.

Don't edit frontmatter by hand, reuse or renumber ids, or move task files yourself.
