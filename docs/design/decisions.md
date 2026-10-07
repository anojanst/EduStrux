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

**Board parts superseded by D-029** (the board moved from Notion to git).

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

## D-019 · 2026-10-07 · Employment agreement checked

- **Decision:** The owner checked the IP and side-business clauses of their employment agreement;
  it permits this project.
- **Tasks:** TUI-1.

## D-020 · 2026-10-07 · Path-based org addressing; public pages use the org slug

- **Context:** Open question: `/orgs/{orgId}` in the URL or a subdomain per centre.
- **Decision:**
  - The API and the app keep path-based addressing, `/api/v1/orgs/{orgId}`, as already built. No
    code change.
  - Public pages (enquiry and enrolment forms, later the parent portal link) use the org slug,
    e.g. web path `/f/{orgSlug}/…`, matching the public API shape `/api/v1/public/{orgSlug}/…`
    (TUI-47). Slugs are already unique across orgs (D-009).
  - A vanity subdomain could be added later as a redirect, not now.
- **Alternatives considered:** a subdomain per centre (rejected: wildcard DNS and TLS, Clerk
  cookies per subdomain, and reworking the middleware).
- **Consequences:** Everything is served from one domain. The org middleware keeps reading
  `orgId` from the path; public routes look the org up by slug.
- **Tasks:** TUI-5 (and TUI-47).

## D-021 · 2026-10-07 · Parents sign in through Clerk, passwordless

- **Context:** Open question: Clerk accounts for parents (they count toward Clerk's free users)
  or our own magic-link tokens for the portal.
- **Decision:** Parents are Clerk users. They sign in passwordless with an email code (or magic
  link) and are linked to a `parent` membership when they accept an invite. Staff and parents use
  the same auth path, so there's no second auth system.
- **Alternatives considered:** our own magic-link tokens (rejected). Signed no-login links in
  emails (not now).
- **Consequences:** At the target (~26 centres, ≤150 students each, roughly 4,000 parents at
  most) parents stay well within Clerk's 50k free monthly retained users. The portal goes through
  the same auth and org middleware as the staff app; what a parent sees comes from the `parent`
  role (handoff §6). Unblocks the parent portal (TUI-39) and parent sign-in (TUI-72).
  Assumption: Clerk sends the sign-in codes and links, so parent sign-in emails don't go through
  our `email` queue (D-015 listed sign-in links there); invite emails may still be ours.
- **Tasks:** TUI-4 (and TUI-39, TUI-72).

## D-022 · 2026-10-07 · MVP cut: four P2 Could items move to v1.1

- **Context:** Open question: is the ~65-feature MVP too big for the first launch?
- **Decision:** Move four P2 Could items to v1.1: term roll-over (TUI-48), student timeline
  (TUI-44), grade timetable view (TUI-53) and drag-and-drop timetable editing (TUI-52).
  Spreadsheet import (TUI-60) and everything else stay in the MVP. The aim is the shortest path
  to the first paying centres without losing anything a centre needs to switch. Import stays
  because centres won't retype 100 students.
- **Consequences:** `GET /students/{id}/timeline` and the roll-over job leave the MVP. Calendar
  views and clash detection (including grade overlaps) stay; only the per-grade weekly grid and
  drag-and-drop editing move. The four tasks stay on the board, marked as moved to v1.1.
- **Tasks:** TUI-2 (moves TUI-44, TUI-48, TUI-52, TUI-53).

## D-023 · 2026-10-07 · Product name and domain: EduStrux, edustrux.com

- **Context:** Open question: product name and domain.
- **Decision:** The product is EduStrux, at edustrux.com. Registering the domain is the owner's
  job.
- **Consequences:** No renaming in code. TUI-3 is Done only once the owner confirms the domain is
  registered (pending on 2026-10-07).
- **Tasks:** TUI-3.

## D-024 · 2026-10-07 · D1 launch region: Oceania

- **Context:** The one shared D1 database lives in one region (handoff §3), and the launch region
  was open.
- **Decision:** Create the D1 database in Oceania (`oc` location hint). The first centres are in
  NZ/AU, near the owner in Auckland.
- **Consequences:** Writes from other regions are slower, which is acceptable for admin work. D1
  read replicas can serve reads closer to users later. A per-region database is needed only when
  a customer requires data residency (the v1.1 data-region feature). Unblocks the deploy half of
  TUI-24: create the D1 database with `--location oc`.
- **Tasks:** TUI-6 (and TUI-24).

## D-025 · 2026-10-07 · PDFs render server-side with Cloudflare Browser Rendering

- **Context:** Open question: render invoice and receipt PDFs in the browser or server-side.
- **Decision:** Render server-side with Cloudflare Browser Rendering: headless Chrome turns
  HTML/CSS templates into PDFs. Reasons:
  - The API already returns PDFs (`GET /invoices/{id}/pdf`, `GET /payments/{id}/receipt`,
    `GET /portal/invoices/{id}/pdf`) and PDF batches run as jobs, so browser-only printing
    doesn't fit.
  - HTML templates make branding easy.
  - Chrome shapes non-Latin scripts correctly (e.g. Tamil names, and Tamil schools are a target
    customer), which a basic PDF library such as pdf-lib doesn't.
- **Alternatives considered:** pdf-lib in the Worker (rejected); print CSS in the browser
  (rejected).
- **Consequences:** Workers Paid includes some browser time each month, then it's billed per
  browser-hour. Each PDF takes a second or two, so batches go through the `jobs` queue. Tests
  check the rendered HTML and stub the renderer. This settles the PDF case D-015 left open: PDF
  text uses the server-side English catalog. Unblocks TUI-59.
- **Tasks:** TUI-7 (and TUI-59).

## D-026 · 2026-10-07 · Search: prefix search first

- **Context:** Open question: SQLite FTS5 or simple prefix search at first.
- **Decision:** Prefix search. Names get normalised (lower-case, accent-stripped) columns with
  indexes that lead with `org_id`. A search matches the start of first, last and family names,
  plus exact email or phone. Duplicate warnings use the same normalised fields. Move to SQLite
  FTS5 only if large centres need word-anywhere search.
- **Alternatives considered (for now):** FTS5 (rejected: virtual tables plus sync triggers);
  contains search (rejected: `LIKE '%x%'` scans every row in the org).
- **Consequences:** A search matches from the start of a name only, not words inside it. The
  normalised columns and their indexes need a migration with TUI-43.
- **Tasks:** TUI-8 (and TUI-43).

## D-027 · 2026-10-07 · Annual billing at launch; USD base with local prices for NZ, AU and UK

- **Context:** Open questions: an annual billing discount, and which currency each country sees.
- **Decision:**
  - **Annual billing at launch**, two months free: Solo US$99/year, Small US$249/year (about 17%
    off).
  - **Displayed currency:** USD is the base. NZD, AUD and GBP get hand-set round local prices in
    Paddle; other countries see Paddle's automatic local-currency conversion.
- **Consequences:** One payment a year saves about $5.50 per customer per year in Paddle's $0.50
  per-transaction fee, brings cash up front and lowers churn. Exact local amounts are set during
  Paddle setup (TUI-73).
- **Tasks:** TUI-9 (and TUI-73).

## D-028 · 2026-10-07 · First school-type template: academic tuition

- **Context:** Open question: which school-type template gets polished first.
- **Decision:** Academic tuition: grade levels × school subjects, term pricing, group classes. It
  matches the grade × subject data model exactly and is the biggest market.
- **Consequences:** Music, language/cultural and dance templates come after, on the same engine.
- **Tasks:** TUI-10.

## D-029 · 2026-10-07 · The project board lives in git, not Notion

- **Context:** The owner doesn't want to pay for Notion, and the free plan's query limit stopped
  the board sync partway through a session.
- **Decision:** Track the build as one markdown file per task in `docs/project/tasks/<phase>/`,
  with YAML frontmatter (`id`, `title`, `status`, `phase`, `module`, `priority`, `size`,
  `endpoints`, `branch`, `pr`) and notes in the body. Statuses are `todo`, `in-progress`,
  `blocked`, `done` and `deferred`. A task's own PR sets its file to `done`, so merging the PR
  updates the board on `main`. In progress and in review aren't stored; `pnpm board` derives them
  from local branches and open PRs. Other status changes go in a `chore/board-<slug>` PR. The 88
  Notion tasks (TUI-1 to TUI-88) were exported on 2026-10-07 with their ids kept. Notion is no
  longer used for this project.
- **Alternatives considered:** one board file with a table per phase (conflicts between PRs that
  edit nearby rows); per-task files plus a committed, generated `BOARD.md` (conflicts on that
  file between open PRs).
- **Consequences:** No paid tool or API limit, and the board's history is in git. Every status
  change is reviewed in a PR. There's no board web view beyond GitHub's file browser and
  `pnpm board`. `CLAUDE.md`, the workflow skills and `docs/project/README.md` describe the new
  flow; D-012's PR-per-task rule stands.
- **Tasks:** none (workflow change).

## D-030 · 2026-10-07 · The audit log is owner-only

- **Context:** The handoff §6 role table had no row for the audit log. The code has granted
  `audit:read` to the owner only since the initial scaffold, and TUI-77 added tests that refuse
  every other role.
- **Decision:** Only the owner can read the audit log (`GET /audit-log`), across the whole org.
  Branch manager, front desk, teacher, parent and accountant get 403.
- **Consequences:** There's no branch-scoped audit view, so a branch manager can't see their
  branch's entries. Opening it to another role later means granting `audit:read` in the
  permission map and a new decision. Assumption: recorded from the implementation; the owner
  hasn't stated a reason.
- **Tasks:** TUI-77.

## D-031 · 2026-10-07 · Every org starts with a "Main" branch

- **Context:** Building branches (TUI-27) raised whether a new org has a branch before the owner
  adds one.
- **Decision:** The owner decided every org gets a default branch named "Main" at creation.
  `POST /orgs` creates it in the same batch as the org and the owner membership (extends D-009).
  It's recorded inside the `org.created` audit row as `after.defaultBranch`, not as a second
  audit row, because two rows written in the same millisecond have no reliable order.
- **Consequences:** Every org has at least one branch, and its last branch can't be deleted
  (D-034). Migration `0003_backfill_default_branches` gives orgs created before this a "Main"
  branch whose id is `brn_` plus the org id's ULID, so it's unique and sorts by the org's
  creation time. The seed script creates its Main branches with the same ids.
- **Tasks:** TUI-27.

## D-032 · 2026-10-07 · Single-tutor mode means exactly one branch

- **Context:** TUI-27 says to hide branches in single-tutor mode, so the API needed a rule for
  what the mode allows.
- **Decision:** The owner decided that an org in single-tutor mode has exactly one branch:
  - `POST /branches` is refused while the mode is on.
  - The reverse also holds: `PATCH /` with `singleTutorMode: true` is refused while the org has
    more than one branch (`fields.singleTutorMode`).
  - Both refusals are `422 unprocessable`, the business-rule status in D-007. The question put
    to the owner said 409.
- **Consequences:** To add a second branch, the owner turns single-tutor mode off first; to turn
  it on, they delete the extra branches first. Assumption: the API still lists the one branch,
  and hiding branches in single-tutor mode is left to the web app (P7).
- **Tasks:** TUI-27.

## D-033 · 2026-10-07 · Setup data: the owner writes, every role reads

- **Context:** The handoff §6 role table had no row for branches, rooms, grade levels and
  subjects.
- **Decision:** Writes need `org:write`, which only the owner has. Reads need `org:read`, which
  every role has (including parent and accountant), across the whole org. The owner decided this
  for rooms; branches, grade levels and subjects were built the same way (assumption: recorded
  from the implementation for those three).
- **Consequences:** A branch manager can't add or edit rooms in their own branch. Because
  `org:read` isn't branch-scoped, a branch manager sees every branch, not only theirs. Letting
  other roles write setup data later needs a new permission and a new decision.
- **Tasks:** TUI-27, TUI-29.

## D-034 · 2026-10-07 · Setup names, branch deletion and rooms

- **Context:** Rules the TUI-27 and TUI-29 implementation settled that the handoff didn't cover.
- **Decision:**
  - Branch, grade level and subject names are unique per org, and room names per branch,
    ignoring case and deleted rows. Partial unique indexes on `lower(name)` enforce it. A clash
    is `409 conflict` with `fields.name: ['Taken']`.
  - Deleting a branch (soft delete) is refused with 422 if it's the org's last branch, still has
    rooms, or any membership lists it in its `branch_ids`.
  - A room stays in its branch: `PATCH /rooms/{roomId}` takes no `branchId`.
  - A PATCH that sends only `updatedAt` changes nothing and returns the record. This applies to
    every PATCH and fixes a 500 on `PATCH /` from TUI-26.
- **Consequences:**
  - SQLite's `lower()` folds A–Z only, so names that differ only in the case of an accented
    letter count as different.
  - Two creates with the same name at the same moment can both pass the check and hit the
    index, returning 500 instead of 409. Follow-up (not built): map D1 unique-constraint errors
    to 409 everywhere.
  - Deleting a room, grade level or subject doesn't yet check whether it's in use. Courses
    (TUI-30) and classes (TUI-31) will need those checks once they reference them.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-27, TUI-29 (and TUI-30, TUI-31 for the in-use checks).

## D-035 · 2026-10-07 · Grade levels are one ordered list, not paged

- **Context:** Grade levels are a short, ordered list, and `PUT /grade-levels/order` works on
  the whole list (TUI-29).
- **Decision:**
  - `GET /grade-levels` returns every grade in order as `{ data, nextCursor: null }`. It isn't
    cursor-paged, an exception to handoff §5. An org can have at most 100 grade levels; creating
    another is 422.
  - Positions start at 1. A new grade goes to the end, and deleting one leaves a gap.
  - `PUT /grade-levels/order` must list every grade exactly once: a duplicate id is 400, an
    unknown, deleted or other org's id is 404, and a missing grade is 422. It writes one
    `grade_level.reordered` audit row with the order before and after.
  - Subjects stay cursor-paged.
- **Consequences:** The response keeps the usual list shape, so clients read it like any other
  list. Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-29.
