# Decisions log

Decisions made during the build that change or add to [handoff.md](handoff.md).
Append-only: a changed decision gets a new entry, and the old one is marked
"Superseded by D-xxx". Maintained by `/update-design-docs`.

Format: `D-NNN · date · title`, then context, decision, consequences and related tasks.

---

## D-001 · 2026-10-05 · Build the API first, UI last

- **Context:** The handoff planned a vertical slice through UI and API together.
- **Decision:** Build and test the whole MVP API through Swagger first (phases P1–P6). The web
  app is a final phase, P7 UI.
- **Consequences:** End-to-end tests are API-level. Parent email-link sign-in and Paddle checkout
  can only be fully checked once there's a UI. Expect small additive API changes when screens
  are built.
- **Tasks:** all `web` module tasks moved to P7 UI.

## D-002 · 2026-10-05 · Swagger UI generated from the routes

- **Decision:** Routes are defined with `@hono/zod-openapi`; the spec is served at
  `/api/openapi.json` and Swagger UI at `/api/docs`. Both are on when `ENABLE_DOCS=true`
  (dev/staging) and off in production.
- **Consequences:** Docs can't drift from the code. Every route needs request/response schemas
  and its error responses (`errors(...)` helper).

## D-003 · 2026-10-05 · Local Clerk tokens for Swagger

- **Decision:** `pnpm seed` creates one test user per role (plus an owner in a second org) in the
  Clerk development instance. `pnpm dev:token <role>` creates a session through Clerk's Backend
  API and mints a token with `expiresInSeconds` (8h default). No JWT template needed.
- **Consequences:** Scripts refuse non-`sk_test_` keys. Not yet run against a real Clerk instance.

## D-004 · 2026-10-05 · Tests sign their own tokens

- **Decision:** Vitest generates a throwaway RSA key pair; the public key is passed as
  `CLERK_JWT_KEY`, so tests go through the same verification code as production with no calls
  to Clerk.

## D-005 · 2026-10-05 · Storage formats

- **Decision:** Timestamps are ISO 8601 UTC text (sortable, returned as-is). IDs are
  `<prefix>_<lowercase ULID>`. JSON columns (`branch_ids`, audit before/after) are text.

## D-006 · 2026-10-05 · Exceptions to "org_id on every table"

- **Decision:** `users` (a person can be in several orgs), `idempotency_keys` (keyed by `scope`,
  which is the org id or, for routes outside an org such as `POST /orgs`, the user id), and
  `orgs` itself. `audit_log` is append-only, so it has no `updated_at`/`deleted_at`.

## D-007 · 2026-10-05 · Error statuses

- **Decision:** Schema validation failures are `400 validation_failed` with `fields`. Business
  rule failures are `422 unprocessable`. Non-members of an org get `404 not_found`; members whose
  role lacks the permission get `403 forbidden`. Stale `updatedAt` is `409 stale_data`.
  Authentication is checked before body validation.

## D-008 · 2026-10-05 · Idempotency-Key behaviour

- **Decision:** The key is claimed before the handler runs (a concurrent retry gets
  `409 request_in_progress`). Only 2xx responses are stored and replayed; failures release the
  key. Reusing a key with a different request is `422 idempotency_key_reused`. Keys expire after
  24h (daily cron).

## D-009 · 2026-10-05 · Org creation defaults

- **Decision:** Org slugs are unique across all orgs (they appear in public form URLs). A slug is
  generated from the name when not given. New orgs start on a 14-day trial (`plan: trial`,
  `status: trialing`) with the creator as owner.

## D-010 · 2026-10-05 · Stale-update check is read-then-write

- **Decision:** PATCH reads the row, compares `updatedAt`, then writes in a batch with the audit
  row. There's a small race window between the read and the write.
- **Consequences:** Acceptable at current scale. Revisit if two staff editing the same record at
  once becomes common.

## D-011 · 2026-10-05 · Workers compatibility date pinned to 2026-08-22

- **Context:** The Vitest Workers pool bundles a runtime that supports dates up to 2026-08-22.
- **Decision:** Pin `compatibility_date` to 2026-08-22 until the test pool is updated.

## D-012 · 2026-10-05 · One pull request per task; Done means merged

- **Context:** The owner wants to review every task before it lands.
- **Decision:** Each task (or small bundle) is built on its own branch
  (`task/tui-<n>-<slug>`) and delivered as one PR with a generated description (changes, design
  changes, how to test in Swagger, checks, review focus). Board status goes In progress →
  In review (PR open) → Done (PR merged). Claude never pushes to `main` or merges. Tasks that
  depend on unmerged work are stacked on that task's branch.
- **Consequences:** The Notion board gains `In review` status and `PR` / `Branch` properties.
  `/open-pr` handles commits and PRs; `/mark-done` reads PR state from GitHub.
  Merged branches are deleted: GitHub removes the remote branch on merge (repo setting on), and
  `/mark-done` removes the local branch.

## D-013 · 2026-10-05 · Protect main

- **Context:** Branch protection and rulesets on a private repo need GitHub Pro. The account is on
  the free plan.
- **Decision:** Protect `main` locally for now. Git hooks block commits on `main` and pushes,
  force-pushes or deletion of `main`. Claude Code deny rules block Claude from pushing to `main`,
  force-pushing, skipping hooks, changing the hooks path and merging PRs. The GitHub ruleset (PR
  required, no force-push or deletion, conversations resolved) is saved in
  `.github/rulesets/protect-main.json`, ready to apply after upgrading.
- **Consequences:** Pushes from other machines, or edits in the GitHub web UI, aren't blocked
  until the ruleset is active. Required status checks get added to the ruleset once CI exists.
- **Update 2026-10-05:** the account was upgraded to GitHub Pro and the ruleset is active (id
  24489131). Pushes from anywhere now go through it.

## D-014 · 2026-10-05 · Claude works as a bot account; the owner reviews

- **Context:** Claude was committing and opening PRs with the owner's GitHub login, and GitHub
  doesn't let a PR's author approve it or request changes, so the owner couldn't review properly.
- **Decision:** Claude acts as a separate bot GitHub account with write access. The owner runs
  `scripts/setup-claude-bot.sh`, which invites and accepts the bot as a collaborator and puts its
  token and git identity in the gitignored `.claude/settings.local.json`, so only Claude Code
  sessions use it. PRs request the owner as reviewer. When the GitHub ruleset is enabled, it
  requires 1 approval, which admins may bypass on a PR (for the owner's own PRs) but never for
  direct pushes.
- **Consequences:** Commits and PRs clearly show what Claude did. The bot can't change repo
  settings or bypass protection. The token needs rotating when it expires (re-run the script).
  Until it's set up, Claude falls back to the owner's login and review is comment-only.

## D-015 · 2026-10-05 · English-only UI, i18n-ready; locale is the formatting region

- **Context:** The product is global, but translating the UI isn't worth it for the MVP. The
  open points were what `orgs.locale` should mean, how the API and server-rendered text handle
  language, and how to avoid a refactor when languages are added.
- **Decision:**
  - **UI language:** English only for the MVP. UI languages stay in v1.1.
  - **Web app:** i18n structure from day one. Every user-facing string goes through a
    `t('key')` lookup with a single `en` catalog, so adding a language later is translation work,
    not a refactor.
  - **API:** JSON stays locale-neutral, with no multi-locale support: no `Accept-Language`
    negotiation and no translated responses. Money is integer minor units + ISO 4217 code,
    timestamps are UTC ISO 8601, calendar dates are `YYYY-MM-DD`. Errors are
    `{ code, message, fields }`: `code` (and field error codes) is the stable key the frontend
    translates; `message` is English for developers.
  - **`orgs.locale`** is kept but means the **formatting region**, not the language, and is
    restricted to English variants (`en-*`, e.g. en-IN, en-GB, en-US, en-ZA, en-NZ). Number,
    money and date formats differ even within English (en-IN groups 12,34,567.50; en-ZA writes
    1 234 567,50; en-US "Oct 5, 2026" vs en-GB "5 Oct 2026"), while allowing e.g. fr-FR would put
    French month names inside an English UI. `orgs.date_format` still overrides the locale's
    default date pattern.
  - **Server-rendered text** (system emails from the email queue: reminders, session changes,
    sign-in links; and invoice/receipt PDFs if TUI-7 picks server-side rendering) uses a single
    English string catalog keyed by id, the same shape as the frontend catalog. No multi-language
    support now. `guardians.language` stays as a stored preference that nothing acts on in the
    MVP (kept for future per-recipient emails and the AI translation add-on).
  - **Org-authored content** (message templates, class and subject names, etc.) is the org's own
    content and is never translated by the product.
  - **Formatting helpers** live in `packages/shared` and are used by both the API (emails, PDFs,
    crons) and the web app, so output is identical everywhere. They do formatting only; there is
    no translation catalog in them.
- **Alternatives considered:** any BCP 47 locale (rejected: mixed-language UI); dropping
  `orgs.locale` and relying on date format + currency (rejected: loses regional number formats
  such as lakh grouping); inline English strings in email/PDF templates (rejected: adding a
  language later would mean refactoring every template).
- **Consequences:** The `Locale` validator in `packages/shared` currently accepts any BCP 47
  locale; tightening it to `en-*` is code work for TUI-25. The `en` catalogs land with TUI-23
  (web), TUI-65 (emails) and TUI-59 (PDFs). Today the validation error `fields` carry Zod's
  English messages rather than stable codes; moving them to codes is code work not yet assigned
  to a task (assumption: to be scheduled).
- **Tasks:** TUI-25, TUI-23, TUI-65, TUI-59 (and TUI-7, which decides where PDFs render).

## D-016 · 2026-10-05 · Daylight saving: local times convert to UTC with the "compatible" rule

- **Context:** Lessons store a local date and time plus the org's timezone (handoff §5), so
  turning them into UTC instants needs a rule for two daylight-saving cases: a local time that
  doesn't exist (clocks go forward) and one that happens twice (clocks go back). It came up
  building the shared date helpers in TUI-25.
- **Decision:** Use Temporal's `"compatible"` disambiguation, the same rule as RFC 5545:
  - A local time skipped when clocks go forward moves forward by the length of the gap
    (Pacific/Auckland 2026-09-27 02:30 → 03:30 NZDT).
  - A local time that happens twice when clocks go back resolves to the earlier instant
    (Pacific/Auckland 2026-04-05 02:30 → the NZDT one, not the NZST one).
- **Alternatives considered:** returning 422 for such times (rejected: a weekly class could fail
  to generate one week a year); resolving a repeated time to the later instant (rejected).
- **Consequences:** Converting a local date + time + timezone to UTC always succeeds, so session
  generation (TUI-31) has no daylight-saving error case. On the clocks-forward day, a lesson
  whose time falls inside the gap starts later by the gap's length. The rule lives in the shared
  date helpers in `packages/shared`, so the API and the web app agree.
- **Tasks:** TUI-25, TUI-31.

## D-017 · 2026-10-07 · Job status during retries

- **Context:** The `jobs` queue retries a failed try (`max_retries` 3). Building the jobs consumer
  in TUI-66 raised what status a polling client sees between tries, and what happens when the
  queue delivers a message again.
- **Decision:**
  - A job becomes `failed` only when its last try fails (try 4 = 1 + 3 retries). A failed try with
    retries left goes back to `queued`, keeping `error` and the `attempts` count.
  - Status only moves forward: `queued` → `running` → `succeeded`, or → `failed` on the last try.
    It never moves from `failed` back to `running`.
  - `succeeded` and `failed` are final, so a message delivered again is ignored.
  - On the last try the job is marked `failed` and the message is acked, rather than left for the
    queue to drop.
  - A job type with no handler fails at once, with no retries.
- **Consequences:**
  - The job gains an `attempts` column and response field. A `queued` job with `attempts > 0` is
    waiting for a retry, and `error` holds the last failure.
  - A retry reruns the whole handler, and the queue can deliver a message more than once, so job
    handlers must be idempotent. This matters for term invoices (TUI-37), promotion (TUI-45) and
    imports (TUI-60).
  - Progress restarts at 0 on each try, and stays at 99 or below until the job succeeds, so 100
    always means finished.
  - No dead-letter queue is configured: final failures are only logged. The retry limit is set in
    both the code and `wrangler.jsonc`, which must stay in step.
- **Tasks:** TUI-66 (and TUI-37, TUI-45, TUI-60, whose handlers must be idempotent).

## D-018 · 2026-10-07 · Only the job's starter and the owner can read a job

- **Context:** `GET /jobs/{id}` needs `org:read`, which every role has. A job's result or error can
  hold data the role otherwise couldn't read.
- **Decision:** Only the person who started the job (`jobs.created_by_user_id`) and the org owner
  can read it. Everyone else in the org gets 404, not 403, so job ids can't be probed. Jobs the
  system started (no `created_by_user_id`) are visible to the owner only.
- **Consequences:** Staff who start a long action can poll it, but colleagues can't see each
  other's jobs, and a branch manager can't see jobs started by their branch staff.
- **Tasks:** TUI-66.
