---
name: recommend-next
description: Recommend the next EduStrux task (or a small bundle of related tasks) to build, based on the Notion board, phase order, dependencies and what already exists in the repo. Read-only. Use when the user asks "what's next", "what should I build", or before starting new work.
argument-hint: "[--module <name>] [--include-ui] [--count N]"
context: fork
agent: general-purpose
background: false
---

# Recommend next

You pick what to build next. You change nothing: no Notion writes, no file edits.
Read `CLAUDE.md` first for the Notion ids and property names, and skim
`docs/design/handoff.md` §8–§9 and `docs/design/decisions.md`.

Arguments: `$ARGUMENTS`

- `--module billing`: only consider that module.
- `--include-ui`: allow P7 UI tasks before the API phases are finished.
- `--count N`: return the top N recommendations (default 1, plus 2 alternatives).

## 1. Load the open tasks

Load the Notion tools with ToolSearch if they're deferred. Query the Tasks data source in `rows`
mode with `Status` `enum_is_not` `Done` (limit 100), and separately note which tasks are Done.

## 2. Check what the code really has

The board can lag behind the code. Run `git fetch origin`, then read `packages/db/src/schema/`
(which tables exist) and the `createRoute` paths in `apps/api/src/modules/*/routes.ts` on
`origin/main` (`git show origin/main:<path>`). A task whose endpoints already exist on main should
be flagged for `/mark-done` rather than recommended.

Also list the open PRs with `gh pr list --json number,title,headRefName,reviewDecision`, so you
know what's waiting for review.

## 3. Rank

Apply these in order:

1. **Finish before starting.** `In progress` build tasks come first, unless blocked. A task
   `In review` with **changes requested** comes before anything new; recommend addressing the
   review (`/open-pr --update` after the fixes).
2. **API-first.** Skip `P7 UI` while any `P0 Must` task in P1–P6 is still open, unless
   `--include-ui` is set (decision D-001).
3. **Phase order.** P1 → P2 → P3 → P4 → P5 → P6.
4. **Dependencies.** A task is only ready when what it needs exists. Within P2, follow the
   handoff's slice order (§12 step 4):
   onboarding → branches/rooms, academic years/terms/holidays, grade levels/subjects, tax rates
   → courses → classes, schedules, sessions → families/guardians/students → enrolments
   → attendance → price rules → invoice generation → payments → parent portal → E2E test.
   Other dependencies to respect:
   - Discounts, PDFs and money reports need invoices.
   - Make-ups and absence notices need sessions and attendance.
   - Overdue reminders need invoices and the email queue.
   - Session-change notices and announcements need the email queue.
   - Promotion needs academic years and student grades.
   - Plan limits need Paddle and students.
5. **Priority:** `P0 Must` before `P1 Should` before `P2 Could`.
6. **Size:** on a tie, the smaller task first.

**Unmerged work.** A dependency that's `In review` (PR open, not merged) still counts as
available, but the new task must be **stacked** on that task's branch. Prefer a ready task that
needs only merged code. Recommend a stacked task only when nothing comparable is unblocked, and
never stack more than 2 deep.

**Review queue.** If 3 or more PRs are waiting for review, say so at the top, and suggest the
user review them before more work piles up. Still give a recommendation.

## 4. Decisions that block work

Decision tasks are the user's to make, not something to build. If the top build candidate
depends on an open decision, say which one and what it changes. Known links:

| Decision | Blocks |
|---|---|
| Parent sign-in: Clerk vs own magic links | Parent portal sign-in, portal routes' auth |
| Org addressing: URL vs subdomain | Only if switching away from `/orgs/{orgId}` (already built) |
| PDF rendering | Invoice PDF + receipts |
| Search approach | Search with duplicate warnings |
| Pricing extras (annual, currency) | Paddle subscription billing |
| Product name and domain | Landing page, email sender domain, production deploy |
| MVP cut | Every `P2 Could` task |

Also flag `P0 Must` decisions that block nothing yet but are overdue (e.g. the employment
agreement IP check).

## 5. Bundling

If the top candidate is `S` and other ready tasks share its module or are plain CRUD in the same
area (e.g. branches/rooms + academic years/terms + grade levels/subjects), recommend them as one
bundle of at most about 3 tasks. Never bundle across phases or with an `L` task.

## 6. Output

```
Review queue: <N open PRs — #12 TUI-27 (approved), #14 TUI-31 (changes requested)>

## Next: TUI-27 Branches and rooms CRUD  (+ TUI-28, TUI-29 as a bundle)
Why: <2–3 lines: phase, dependency satisfied, what it unblocks>
Base: main   (or: stacked on task/tui-24-… — PR #11 not merged yet)
Scope:
- Endpoints: ...
- Tables: ...
- Permissions: <from handoff §6 / packages/shared/src/permissions.ts>
- Watch out for: <tricky rules from the handoff>

Alternatives
1. TUI-xx … — why
2. TUI-yy … — why

Decisions needed from you: <list, or "none blocking">
Board drift: <tasks whose code exists but aren't Done → run /mark-done>
```

Name tasks by `TUI-n` and title so `/implement-task` can take them directly.
