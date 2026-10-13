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

**"Off in production" overridden until launch by D-068** (the docs are on in production while it
is the only deployed environment).

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
- **Update 2026-10-08:** `pnpm seed` and `pnpm dev:token <role>` were confirmed against the
  owner's real Clerk development instance (TUI-88). Tokens for owner, teacher and owner_b are
  accepted by the API with the right role and org.

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
- **Update 2026-10-11:** The link to a family is `guardians.membership_id`: a guardian row points
  at the parent's membership (D-053). Nothing sets it yet; accepting an invite will (TUI-42,
  TUI-72).

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
- **Update 2026-10-11:** The normalised name columns were created with the families, guardians
  and students tables in TUI-32, so TUI-43 needs no backfill (D-056). The search indexes on
  guardian names and email, phone normalisation, `GET /search` and duplicate warnings are still
  TUI-43's.

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
- **Update 2026-10-08:** `pnpm board:web` (the board.md package, added in #11) serves a local web
  board of the task files on http://127.0.0.1:4600. Status changes made by dragging cards still
  ship in a `chore/board-<slug>` PR.

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
- **Update 2026-10-11:** Courses are the one exception: the owner, branch managers and front
  desk write them (D-041).

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
- **Update 2026-10-11:** Deleting a grade level or subject is now refused (422) while a course
  uses it (D-043). The room check is still open for TUI-31.
- **Update 2026-10-11 (TUI-31):** Deleting a room is now refused (422) while a class uses it, and
  so is deleting a branch that has classes (D-050). The in-use checks left open here are all
  done.
- **Update 2026-10-11 (TUI-32):** Deleting a branch is also refused (422) while it is a family's
  home branch, and deleting a grade level while a student grade record uses it (D-057).

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

## D-036 · 2026-10-08 · Terms are optional: a class without a term is billed monthly

- **Context:** Building terms (TUI-28) raised how a centre that bills monthly, without school
  terms, fits a model where classes and invoices hang off terms.
- **Decision:** The owner decided terms are optional per class:
  - A class either belongs to a term and is billed per term, or has no term: it runs open-ended
    from its start date and is billed monthly.
  - One centre can mix both kinds of class.
  - Academic years always exist, because student grades are stored per academic year.
- **Consequences:**
  - A class's term will be optional (TUI-31), and pricing (TUI-36) and invoice generation
    (TUI-37) must handle both kinds of class.
  - TUI-37 needs a month-based "generate invoices" action next to
    `POST /terms/{id}/generate-invoices`. Its path isn't decided yet.
- **Tasks:** TUI-28 (and TUI-31, TUI-36, TUI-37).
- **Update 2026-10-11:** Built in TUI-31. A class's `termId` is optional; a class without one
  needs a `startDate` (D-049) and has its sessions generated 13 weeks ahead (D-044).
- **Update 2026-10-13 (TUI-36):** Pricing handles both kinds of class. A course's default price
  and an enrolment's override are charged per term for a class in a term and per month for one
  with none (D-077). A `per_term` price rule only fits a class in a term and a `per_month` one a
  class with no term (D-081). The month-based invoice action is still undecided (TUI-37).

## D-037 · 2026-10-08 · Academic year and term rules

- **Context:** TUI-28 needed rules for how academic years and terms relate in time.
- **Decision:** The owner decided:
  - Academic years can't overlap, not even by one day. Back-to-back years are fine.
  - A term sits inside its academic year, and terms can't overlap each other.
  - Changing a year's dates is refused if the year would overlap another year or leave one of
    its terms outside.
  - Academic years can't be deleted: there's no `DELETE /academic-years/{academicYearId}`.
  - A term stays in its academic year: `PATCH /terms/{termId}` takes no `academicYearId`.
  - Every refusal is `422 unprocessable`.
- **Consequences:** Any date belongs to at most one academic year and at most one term. A term in
  the wrong year is deleted and created again. There's no "current academic year" flag yet;
  families and students (TUI-32) will need one, worked out in the org's timezone.
- **Tasks:** TUI-28 (and TUI-32).
- **Update 2026-10-11:** TUI-32 defined the current academic year as a rule, not a stored flag:
  the year today falls in, else the one that ended most recently, else the first one to start,
  worked out in the org's timezone (D-055).

## D-038 · 2026-10-08 · Holidays: a date range, org-wide or for one branch

- **Context:** TUI-28 needed to settle what a holiday covers.
- **Decision:** The owner decided:
  - A holiday is a date range; a single day has the same start and end date.
  - It closes the whole org by default, or one branch when `branchId` is given.
  - Holidays aren't tied to academic years, since a break can cross the boundary between two
    years.
  - `GET /holidays?branchId=X` returns what closes branch X: its own holidays plus the org-wide
    ones. `?from` and `?to` keep holidays that touch the range.
  - There's no `PATCH /holidays/{holidayId}` (it isn't in the endpoint list): delete the holiday
    and add it again.
- **Consequences:**
  - Session generation (TUI-31) must skip a date when it falls in a holiday that is org-wide or
    for the class's branch.
  - Deleting a branch is also refused (422) while it has its own holidays; org-wide holidays
    don't block it. This extends D-034's branch-deletion rules. Assumption: recorded from the
    implementation; the owner hasn't stated this rule.
- **Tasks:** TUI-28 (and TUI-31).
- **Update 2026-10-11:** Session generation skips holidays (D-047). A holiday added after
  sessions were generated removes the sessions it closes; deleting one doesn't put them back
  (D-046).

## D-039 · 2026-10-08 · Tax rates: owner writes, every role reads; rate in basis points

- **Context:** TUI-35. Handoff §6's "Org settings, tax, plan" row gave the owner full access, the
  accountant read access and other roles none.
- **Decision:** The owner decided:
  - Every role reads tax rates (`org:read`); only the owner writes them (`org:write`), the same
    as setup data in D-033. This replaces the tax part of the §6 row.
  - A rate is `rateBps`, an integer in basis points from 0 to 10000 (1500 = 15%, 1250 = 12.5%,
    0 = zero-rated), stored as-is in `rate_bps`. The owner chose this for consistency with money,
    which is also an integer (minor units). Non-integers, strings, negatives and values over
    10000 are 400.
  - Only 2 decimals of a percent are supported: 8.875% can't be entered (it would be 887 or 888).
  - Every rate has a required `inclusive` flag.
  - No tax rates means no tax, which is a valid setup.
  - Invoices show the org's existing `taxNumber`.
- **Consequences:** Parents and teachers can see the org's tax rates. Rates need no conversion
  between the API and the database. Deleting a tax rate doesn't yet check whether it's in use;
  price rules (TUI-36) will need that check.
- **Tasks:** TUI-35 (and TUI-36, TUI-37).
- **Update 2026-10-13 (TUI-36):** The owner decided one tax rate is the org's default and
  applies to every price that doesn't name its own (D-080). Tax rates gained `isDefault` for it
  (D-084). Deleting a tax rate is now refused (422) while a price rule names it (D-085).

## D-040 · 2026-10-08 · Calendar and tax-rate lists, names, dates and permissions

- **Context:** Rules the TUI-28 and TUI-35 implementation settled that the handoff didn't cover.
- **Decision:**
  - Academic years, terms and holidays: every role reads (`org:read`), only the owner writes
    (`org:write`), as for setup data (D-033).
  - Academic years, terms and holidays are listed by start date, then id, with normal cursor
    paging; the cursor holds both. Tax rates are listed oldest first by id.
  - Academic year and tax rate names are unique per org, and term names within their academic
    year, ignoring case and deleted rows (`409 conflict`, as in D-034). Holiday names can repeat.
  - Date ranges include both ends. An end date before the start date is
    `400 validation_failed` on `endDate`, including a PATCH whose new end falls before the stored
    start. A malformed date gets only its own format error.
- **Consequences:** Deleting a term doesn't yet check whether it's in use; classes (TUI-31) will
  need that check. Assumption: recorded from the implementation; the owner hasn't stated these
  rules.
- **Tasks:** TUI-28, TUI-35 (and TUI-31).
- **Update 2026-10-11:** Deleting a term is now refused (422) while a class uses it (D-050).

## D-041 · 2026-10-11 · Courses: who writes them, what makes one unique, what duration means

- **Context:** TUI-30. The handoff said a course is subject × grade with an optional curriculum,
  teaching medium, default price and duration. It didn't say who writes courses, what makes one
  unique or what duration means. The owner was asked three questions during the build.
- **Decision:** The owner decided:
  - The owner and branch staff write courses. Writes need `classes:write`, which the owner,
    branch managers and front desk have; teachers, parents and accountants get 403. A course has
    no branch, so that permission's `branch` scope isn't applied: a branch manager or front desk
    member limited to one branch changes courses for the whole org.
  - A course is unique on subject + grade level + curriculum + teaching medium, ignoring case and
    deleted rows. It has no name of its own: clients build the display name from the grade level
    and subject (e.g. "Year 10 Mathematics"), plus the curriculum and medium when set.
  - Duration is the usual lesson length in minutes, stored and returned as `durationMinutes`.
- **Consequences:**
  - This departs from D-033's "only the owner writes setup data", for courses only. Branches,
    rooms, grade levels, subjects, the calendar and tax rates stay owner-written.
  - "Year 10 Maths (Cambridge)" and "Year 10 Maths (NCEA)" can both exist.
  - `durationMinutes` will pre-fill a class's end time (TUI-31).
- **Tasks:** TUI-30 (and TUI-31).
- **Update 2026-10-11:** Built in TUI-31. A weekly slot sent without an `endTime` ends
  `durationMinutes` after its `startTime` (D-050).

## D-042 · 2026-10-11 · Every role reads courses (assumption, for the owner to confirm)

- **Context:** When the owner chose "owner and branch staff" for course writes (D-041), the
  option's text said accountants would lose read access: it assumed reads would move to
  `classes:read`. The build kept `org:read` instead.
- **Decision:** Reads need `org:read`, so every role (including teacher, parent and accountant)
  reads all courses across the org, as for the rest of the setup data (D-033). The reasons
  reported by the implementation: `classes:read` gives teachers and parents the `own` scope,
  which can't be applied to courses before classes exist, and a course list is catalogue data
  like subjects. **Assumption: recorded from the implementation. It differs from the option the
  owner picked, so the owner needs to confirm it at review.**
- **Consequences:** Teachers, parents and accountants can see every course, including its default
  price. Restricting reads later means a different permission on `GET /courses` and a new
  decision. Tracked as an open question in handoff §11.
- **Tasks:** TUI-30.

## D-043 · 2026-10-11 · Course fields, default price, filters and in-use checks

- **Context:** Rules the TUI-30 implementation settled that the handoff didn't cover.
- **Decision:**
  - A second course with the same subject, grade level, curriculum and teaching medium is
    `409 conflict` with `fields._: ['Taken']`, since no single field is at fault (`_` is the
    existing key for an error on the whole object). A partial unique index enforces it.
  - A missing curriculum or medium counts as its own value: a course with no curriculum and one
    with "Cambridge" are different, and null is the same as leaving the field out. A PATCH that
    would make two courses identical is also 409; changing only the letter case of a course's
    own label is allowed.
  - A course keeps its subject and grade level: `PATCH /courses/{courseId}` takes no `subjectId`
    or `gradeLevelId` and ignores them if sent. To change them, delete the course and add it
    again, as for rooms (D-034) and terms (D-037).
  - Curriculum and teaching medium are optional free-text labels, 1–60 characters, trimmed; null
    clears one. The API field is `teachingMedium`. Handoff §7 put both on the course while §8
    listed "curriculum/medium tags" under v1.1: the MVP has plain text, and the v1.1 item means
    managed tags and filtering.
  - `defaultPrice` is Money (`{ amount, currency }`) or null. The amount is an integer of 0 or
    more (0 = free). The currency must be the org's, otherwise `400 validation_failed` on
    `defaultPrice.currency`. It's stored as two columns (amount, currency), the first money
    columns in the database.
  - `durationMinutes` is an integer from 5 to 600.
  - Deleting a grade level or subject is refused (`422 unprocessable`) while a non-deleted course
    uses it. This is the TUI-30 part of the in-use checks D-034 left open.
  - `GET /courses` is cursor-paged, oldest first by id, with filters `?subjectId` and
    `?gradeLevelId` (either or both). A filter id the org doesn't have (unknown, deleted or
    another org's) is 404, like `?academicYearId` on terms. So is such a `subjectId` or
    `gradeLevelId` on `POST`.
  - The path parameter is `{courseId}` (the handoff wrote `/courses/{id}`), following the other
    setup routes. There's no `GET /courses/{courseId}`, as in the handoff's list.
- **Consequences:**
  - What the default price is charged for (per term, per lesson, per month) isn't defined. Price
    rules (TUI-36) must define it.
  - If the org's currency changes later, existing course prices keep the currency they were saved
    with. Nothing converts them or blocks the change yet.
  - Deleting a course doesn't yet check whether a class uses it; classes (TUI-31) will need that
    check.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-30 (and TUI-31, TUI-36).
- **Update 2026-10-11:** Deleting a course is now refused (422) while a class uses it (D-050).
- **Update 2026-10-11 (TUI-32):** Deleting a grade level is also refused (422) while a student
  grade record uses it (D-057).
- **Update 2026-10-13 (TUI-36):** The owner decided what the default price is charged for: one
  billing period of the class, a term or a month (D-077). A price rule for the course or the
  class replaces it (D-082). Deleting a course is also refused (422) while a price rule prices
  it (D-085).

## D-044 · 2026-10-11 · Sessions for a class with no term are generated 13 weeks ahead

- **Context:** TUI-31 turns a class's weekly schedule into dated sessions. A class in a term ends
  with its term, but a class with no term runs open-ended (D-036), so the generator needed a
  limit. The owner was asked during the build.
- **Decision:** The owner decided sessions for a class with no term are generated 3 months ahead.
  It's built as 91 days (13 weeks) from today in the org's timezone, or up to the class's
  `endDate` when that comes first. A class in a term always generates to the end of its term, or
  to its own `endDate` when that is earlier.
- **Consequences:**
  - The daily cron (TUI-68) will keep extending open-ended classes. Until it exists, nothing
    extends them automatically: saving the class's schedule again tops its sessions up.
  - The 91 days count from today, not from the class's start date, so a class that starts further
    ahead than that has no sessions yet.
  - `PUT /classes/{classId}/schedule` returns `sessions.through`, the last date sessions are
    generated up to.
- **Tasks:** TUI-31 (and TUI-68).

## D-045 · 2026-10-11 · One audit row per schedule change, not one per session

- **Context:** Every write so far has carried its own audit row. Saving a schedule can add and
  remove a few hundred sessions at once, the first bulk write in the build. The owner had
  deferred the question of audit-log growth on 2026-10-07 (the "To revisit" note in the TUI-79
  task file, where this is option 2), so it was put to the owner during the TUI-31 build.
- **Decision:** The owner decided a schedule change writes one audit row, not one per session.
  `class.schedule_set` records the weekly slots before and after, plus `sessionsAdded` and
  `sessionsRemoved`. The other TUI-31 writes that touch many sessions were built the same way
  (recorded from the implementation):
  - `class.updated` carries `sessionsAdded` and `sessionsRemoved` when a change of the class's
    dates adds and removes sessions. The sessions a new room or teacher is copied onto aren't
    listed or counted.
  - `class.deleted` is one row for the class, its weekly slots and all its sessions.
  - `holiday.created` carries `after.sessionsRemoved` (D-046).
- **Consequences:**
  - The audit log says how many sessions a change added or removed, not which ones.
  - This settles option 2 in the TUI-79 note ("one audit row per bulk action") for session
    generation. Attendance marking (TUI-34) and invoice runs (TUI-37) should follow the same
    rule unless the owner says otherwise.
  - The other two options there stay deferred: storing only the changed fields in
    `before`/`after`, and archiving old audit rows to R2.
- **Tasks:** TUI-31 (and TUI-34, TUI-37, TUI-79).
- **Update 2026-10-12 (TUI-34):** Attendance marking follows the rule: one `attendance.marked`
  row per request, not one per student. Its `before` and `after` list only the students whose
  status changed, the first audit row to store only what changed. The general "changed fields
  only" option and archiving stay deferred (D-075).

## D-046 · 2026-10-11 · A holiday added later removes the sessions it closes

- **Context:** D-038 said session generation skips holidays. TUI-31 raised what happens when a
  holiday is added after sessions were already generated on its dates. The owner was asked during
  the build.
- **Decision:** The owner decided:
  - `POST /holidays` removes (soft-deletes) the sessions the holiday closes that are still
    `scheduled` and haven't started: every branch's for an org-wide holiday, one branch's for a
    branch holiday.
  - They're removed in the same batch as the holiday. The count is recorded as
    `after.sessionsRemoved` on the `holiday.created` audit row, with no row per session (D-045).
  - Deleting a holiday doesn't put sessions back by itself. They return when the class's schedule
    is saved again, and later through the daily cron (TUI-68).
- **Consequences:**
  - This extends D-038. Sessions that have started, and sessions with another status, stay.
  - Until TUI-68, getting sessions back after deleting a holiday means saving each affected
    class's schedule again.
  - Things later attached to an upcoming session (absence notices, make-up bookings, one-off
    moves in TUI-49) need a rule for when a holiday or a schedule change removes that session.
    Not decided yet.
- **Tasks:** TUI-31 (and TUI-49, TUI-68).
- **Update 2026-10-12 (TUI-34):** Attendance has its rule. A session can be marked only from its
  own day on, so one removed days ahead has no marks. A session marked today before it starts can
  still be removed that day; its marks stay in the table, hidden with the session (D-070).
  Absence notices, make-up bookings and one-off moves still need their own rule.

## D-047 · 2026-10-11 · How sessions are generated: upcoming only, by diff, stored in local time

- **Context:** Rules the TUI-31 implementation settled for turning weekly slots into sessions.
  The task said only that saving the schedule regenerates future sessions.
- **Decision:**
  - Started sessions never change. The generator only touches sessions that haven't started,
    judged in the org's timezone: a date after today, or today with a start time after now. It
    never creates a session in the past either.
  - Regeneration is a diff, not a wipe. On `PUT /classes/{classId}/schedule`, and on a change of
    the class's dates, upcoming sessions that already match a wanted date, start time and end
    time are kept with their ids; `scheduled` ones that no longer match are soft-deleted; missing
    ones are added. A changed end time replaces the session (new id).
  - A session's `status` is `scheduled` or `cancelled`. Only `scheduled` is written so far;
    `cancelled` is for TUI-49. The generator never removes a session with any status other than
    `scheduled`. It keeps its slot, so no second session is created at the same date and start
    time.
  - Saving the same slots twice changes nothing and writes no audit row.
  - A date closed by a holiday, org-wide or for the class's branch, gets no session (D-038).
  - Sessions store the local date and the local start and end times only; no UTC columns. The
    API returns `date`, `startTime` and `endTime` (local) plus `startsAt` and `endsAt` (UTC),
    worked out when read from the org's current timezone with the D-016 rule. The handoff §5
    example used `"start": "16:00"`.
  - A partial unique index on org, class, date and start time stops the same session being
    created twice.
  - Generation runs inside the request, not as a job: one batch of at most a few hundred rows.
- **Consequences:**
  - A 4 pm class stays at 4 pm across daylight saving, and `startsAt`/`endsAt` follow a later
    change of the org's timezone.
  - A class whose term has already begun gets sessions from now on only. Past lessons can't be
    back-filled yet.
  - Changing a term's dates (`PATCH /terms/{termId}`) doesn't regenerate its classes' sessions:
    staff save the schedule again. Nothing stops a term shrinking under a class's own dates.
  - Anything later attached to an upcoming session needs a rule for when a schedule change
    removes it (see D-046).
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-31 (and TUI-49, TUI-68).
- **Update 2026-10-12 (TUI-34):** For attendance, marking opens on the session's day, not at its
  start time, so the generator can still remove a session that was marked earlier the same day.
  The generator itself is unchanged (D-070).

## D-048 · 2026-10-11 · Who reaches classes and sessions

- **Context:** Handoff §6's "Classes and timetable" row gives each role a reach: full, branch,
  own classes (read), own children (read) or none. TUI-31 is the first module to apply the
  `branch` and `own` scopes, so it settled what they mean in the API.
- **Decision:**
  - Owner: every class and session, read and write.
  - Branch manager and front desk: read and write, only the classes in their membership's
    branches and those classes' sessions. A membership with no branch list (null) reaches every
    branch; an empty list reaches none.
  - Teacher: read only, and only the classes they teach and those classes' sessions. A write is
    refused with 403.
  - Accountant: 403 on every class and session route.
  - Parent: lists return 200 with no rows, and a single class or session is 404. "Own children"
    needs enrolments, so TUI-33 must wire it.
  - A class or session outside the caller's reach is 404, as if it didn't exist. So is a
    `?classId` filter on `GET /sessions` for such a class.
  - The exception is `POST /classes` with a `branchId` outside a branch-limited member's
    branches: 403, since they can see that the branch exists (D-033).
- **Consequences:**
  - A teacher's reach follows the class's teacher, not the teacher copied onto each session
    (D-049).
  - Until TUI-33, parents see no classes or sessions through these routes, and `GET /sessions`
    has no `?student` filter.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-31 (and TUI-33).
- **Update 2026-10-11 (TUI-32):** Families, guardians and students follow the same pattern, with
  the family's home branch as the branch (D-051, D-053). There a parent reads their own family,
  and it's the teacher who gets empty lists until TUI-33.
- **Update 2026-10-12 (TUI-33):** A parent now reads the classes one of their children holds an
  active enrolment in, and those classes' sessions (D-060). `GET /sessions` has the student
  filter, named `?studentId` (D-063).
- **Update 2026-10-12 (TUI-34):** A teacher now marks attendance for the classes they teach,
  their first write. Class and session routes stay read-only for them. A session's attendance is
  reached through the session, with this reach (D-073).

## D-049 · 2026-10-11 · Class rules: what a class keeps, its name, dates, teacher and room

- **Context:** Rules the TUI-31 implementation settled for classes that the handoff didn't cover.
- **Decision:**
  - A class keeps its course, term and branch: `PATCH /classes/{classId}` takes no `courseId`,
    `termId` or `branchId` and ignores them if sent. To change them, delete the class and add it
    again, as for courses (D-043). PATCH can change `name`, `roomId`, `teacherId`, `capacity`,
    `startDate` and `endDate`.
  - A class stores its course's grade level (`gradeLevelId`). A course never changes its grade
    (D-043), so classes and sessions filter by grade without reading the curriculum tables.
  - The name (e.g. "Group A") is required, 1–120 characters, and unique among the same course's
    classes in the same term and branch, ignoring case and deleted rows: `409 conflict` with
    `fields.name: ['Taken']`. Two open-ended classes of the same course and branch also clash. A
    partial unique index enforces it.
  - Dates. In a term, `startDate` and `endDate` are optional and narrow the term; they must fall
    inside it (`422 unprocessable` with `['Outside the term']` on `fields.startDate` or
    `fields.endDate`). Without a term, `startDate` is required (400) and a null `endDate` means
    until further notice. An `endDate` before the `startDate` is 400.
  - Changing the dates adds and removes upcoming sessions (D-047). The counts go in the
    `class.updated` audit row (D-045).
  - The teacher is a membership id, exposed as `teacherId`. Any active member who isn't a parent
    can teach, whatever their role: a solo tutor is the owner. An unknown or other org's id is
    404; a parent or a suspended member is 422 on `fields.teacherId`.
  - A room must be in the class's branch, otherwise 422 with
    `fields.roomId: ['In another branch']`. The room is per class, not per weekly slot.
  - `capacity` is 1–1000, or null for no limit. Room, teacher and capacity are all optional.
  - A session carries its own room and teacher, copied from the class when the session is
    generated. Changing the class's room or teacher also updates its upcoming `scheduled`
    sessions in the same batch; sessions that have started keep the old ones.
  - `DELETE /classes/{classId}` soft-deletes the class, its weekly slots and all its sessions,
    past ones too, with one `class.deleted` audit row.
- **Consequences:**
  - Enrolments (TUI-33) and attendance (TUI-34) must refuse deleting a class that has enrolments
    or attendance.
  - Removing or suspending a staff member (TUI-42) must deal with the classes and upcoming
    sessions they teach.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-31 (and TUI-33, TUI-34, TUI-42).
- **Update 2026-10-12 (TUI-33):** Deleting a class is now refused (422) while it has enrolments
  (D-063). The attendance check is still TUI-34's.
- **Update 2026-10-12 (TUI-34):** No attendance check was added. A class with attendance already
  has enrolments, and those block deleting it (D-063, D-075).
- **Update 2026-10-13 (TUI-36):** Deleting a class is also refused (422) while it has a price
  rule of its own. The rule isn't deleted with the class (D-085).

## D-050 · 2026-10-11 · Schedule slots, class and session lists, in-use checks and paths

- **Context:** More rules the TUI-31 implementation settled that the handoff didn't cover.
- **Decision:**
  - `PUT /classes/{classId}/schedule` takes the class's whole weekly schedule as
    `{ slots: [{ weekday, startTime, endTime? }] }` and returns
    `{ class, sessions: { added, removed, kept, through } }`. A class has at most 14 slots.
    Weekdays are ISO, 1–7. It takes no `updatedAt`.
  - `endTime` is optional and defaults to `startTime` plus the course's `durationMinutes`
    (D-041). With no duration on the course it is 400 on `slots.N.endTime`, as is a lesson that
    would run past midnight. `endTime` must be after `startTime`.
  - Two slots on the same weekday can't overlap (400 on `slots.N`). Back-to-back is fine.
  - An empty list clears the schedule and removes the class's upcoming sessions.
  - `GET /classes` is cursor-paged, oldest first by id, and each class carries its weekly
    `schedule`. Filters: `?branchId`, `?termId`, `?courseId`, `?gradeLevelId`, `?teacherId`.
  - `GET /sessions` needs `from` and `to` (local dates, both included); a `to` before `from` is
    refused with 400. Sessions come by date, start time, then id, and the cursor holds all three.
    Filters: `?branchId`, `?roomId`, `?teacherId`, `?gradeLevelId`, `?classId`.
  - A filter id the org doesn't have is 404 on both lists, as for courses (D-043).
  - A course, term, room or branch can't be deleted while a non-deleted class uses it
    (`422 unprocessable`). This closes the in-use checks D-034 (rooms), D-040 (terms) and D-043
    (courses) left open, and adds classes to D-034's branch-deletion rules.
  - The path parameters are `{classId}` and `{sessionId}` (the handoff wrote `{id}`).
  - A weekly slot row has the new id prefix `csl_`.
  - Not built here, as planned: `PATCH /sessions/{sessionId}` (TUI-49), `GET /timetable/clashes`
    (TUI-50) and the `?student` filter on `GET /sessions` (TUI-33).
- **Consequences:**
  - A lesson can't cross midnight.
  - Saving a schedule has no stale-data check, so when two people save one class's schedule the
    later save wins.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-31 (and TUI-33, TUI-49, TUI-50).
- **Update 2026-10-12 (TUI-33):** `GET /sessions` now takes `?studentId`, which the handoff
  wrote as `?student` (D-063).
- **Update 2026-10-13 (TUI-36):** Deleting a course is also refused (422) while a price rule
  prices it (D-085).

## D-051 · 2026-10-11 · A family has a home branch

- **Context:** Handoff §6 gives branch managers and front desk "Branch" reach over families and
  students, but nothing tied a family or a student to a branch. TUI-32 needed that link. The
  owner was asked during the build.
- **Decision:** The owner decided a family has a home branch: `branchId`, required. Its guardians
  and students go with it. A branch manager or front desk member limited to some branches sees
  and changes only the families whose home branch is one of theirs. The owner chose this over
  "each student has a home branch" and "no branch on families".
- **Consequences:**
  - A child who attends a class at another branch will show on that class's roster through
    enrolments (TUI-33). Only the home branch, the owner and staff with no branch limit change
    the family record.
  - A branch-limited member can't see a student whose family's home branch is another one, even
    to enrol them in a class at their own branch. TUI-33 must decide how cross-branch enrolment
    works. Tracked as an open question in handoff §11.
  - Every student is returned with `branchId`, their family's home branch, and the family and
    student lists filter by it.
  - A branch can't be deleted while it is a family's home branch (D-057).
- **Tasks:** TUI-32 (and TUI-33).
- **Update 2026-10-12 (TUI-33):** The owner decided cross-branch enrolment: the caller must reach
  both the student and the class (D-058). The roster shows the child by name, since each
  enrolment carries the student's name (D-061).

## D-052 · 2026-10-11 · No consent fields yet: consents wait for privacy controls

- **Context:** The handoff listed "consents" on family and student records (§7, §8) without
  naming them. The owner was asked during the TUI-32 build whether to add photo or medical
  consent now.
- **Decision:** The owner decided to add none in TUI-32. Every consent field is left to privacy
  controls (TUI-79).
- **Consequences:** Families, guardians and students carry no consent columns yet. TUI-79 must
  define which consents exist and where they're recorded, and add them with a migration. Consents
  stay in the MVP (handoff §8).
- **Tasks:** TUI-32 (and TUI-79).

## D-053 · 2026-10-11 · Who reaches families, guardians and students

- **Context:** Handoff §6's "Families and students" row gives each role a reach: full, branch,
  own classes (read), own family or none. TUI-32 applied the `branch` and `own` scopes to people
  as D-048 did for classes, using the home branch from D-051.
- **Decision:**
  - Owner: every family, guardian and student, read and write.
  - Branch manager and front desk: read and write, only the families whose home branch is in
    their membership's branches. A membership with no branch list (null) reaches every branch; an
    empty list reaches none.
  - Parent: read only, and only the families where one of the guardians is linked to the
    parent's membership (a signed-in guardian). A write is refused with 403.
  - Teacher: lists return 200 with no rows, and a single family or student is 404. "Own classes"
    needs enrolments, so TUI-33 must wire it. A write is refused with 403.
  - Accountant: 403 on every family, guardian and student route.
  - Guardians and students are reached through their family.
  - Anything outside the caller's reach is 404, as if it didn't exist (the D-048 rule). So is a
    `?familyId` filter on `GET /students` for such a family.
  - Two exceptions are 403, since the member can see that the branch exists (D-033):
    `POST /families` with a `branchId` outside a branch-limited member's branches, and
    `PATCH /families/{familyId}` moving a family to such a branch.
  - The parent link is `guardians.membership_id`, returned read-only as `membershipId`. It ties a
    guardian to a `parent` membership. One parent membership can be a guardian in more than one
    family, and then reaches all of them.
- **Consequences:**
  - Nothing in the API sets `membershipId` yet: accepting an invite will (TUI-42, TUI-72). Until
    then no parent reaches a family; the tests set the link directly.
  - Removing a parent's membership (TUI-42) must clear `guardians.membership_id`.
  - Teachers see no families or students until TUI-33.
  - The handoff's "Own family" for parents is read-only. Parent profile updates are v1.1
    (handoff §8).
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-32 (and TUI-33, TUI-42, TUI-72).
- **Update 2026-10-12 (TUI-33):** A teacher now reads the students who hold an active enrolment
  in a class they teach, with those students' families and guardians (D-060).

## D-054 · 2026-10-11 · Guardians: contact fields, the billing contact and emergency contacts

- **Context:** The TUI-32 task listed a billing contact, preferred channel, language and
  emergency contacts without saying how they're stored. These are the rules the implementation
  settled.
- **Decision:**
  - A guardian is any contact person for a family: a parent, or a grandparent or neighbour to
    call in an emergency. `relationship` is optional free text (1–60 characters), and
    `emergencyContact` is a flag, true by default. There is no separate emergency-contacts table
    or list.
  - First and last name are required, 1–80 characters each.
  - `email` is optional, trimmed and stored lower-case. `phone` is optional, 3–30 characters:
    digits, spaces and `+ ( ) . -`. Neither is required, and neither has to be unique.
  - `preferredChannel` is `email`, `sms` or `whatsapp`, default `email`. It is a stored
    preference only, since the MVP sends email only.
  - `language` is a language tag such as `en`, `mi` or `si`. It is stored only (D-015).
  - A guardian stays in their family: `PATCH /guardians/{guardianId}` takes no `familyId` and
    ignores it if sent.
  - The billing contact is `families.billingGuardianId`, which points at one guardian. The
    family's first guardian becomes the billing contact automatically, in the same batch,
    recorded as `after.billingContact: true` on the `guardian.created` audit row.
  - `PATCH /families/{familyId}` can change it to another guardian of the same family. Any other
    id is `422 unprocessable` with `fields.billingGuardianId: ['Not a guardian of this family']`.
    It can't be set to null.
  - The billing contact can't be deleted (422) until another guardian takes over.
- **Consequences:**
  - A family's last guardian goes only when the family is deleted. `billingGuardianId` is null
    only while a family has no guardians.
  - A guardian can have no email and no phone, so anything that contacts guardians must handle
    that.
  - The same person can be entered twice. Duplicate warnings are TUI-43's.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-32 (and TUI-43).

## D-055 · 2026-10-11 · Students: fields, a grade per academic year, the current academic year

- **Context:** The handoff says `student_grades` stores a student's grade per academic year, and
  D-037 left the "current academic year" rule to TUI-32. These are the rules the implementation
  settled.
- **Decision:**
  - First and last name are required, 1–80 characters each. `dateOfBirth` is optional and can't
    be in the future, judged in the org's timezone (400). `notes` is optional free text, up to
    2000 characters, visible to anyone who can read the student.
  - A student stays in their family: `PATCH /students/{studentId}` takes no `familyId` and
    ignores it if sent.
  - A student has no status (active or inactive) field.
  - `student_grades` holds at most one grade level per student per academic year. A partial
    unique index enforces it.
  - `POST /students` and `PATCH /students/{studentId}` take `gradeLevelId` and an optional
    `academicYearId`. With no year named, the grade is for the current academic year. Setting a
    grade for a year that already has one replaces it. `PATCH` with `gradeLevelId: null` removes
    that year's grade. `academicYearId` without `gradeLevelId` is 400.
  - A `familyId`, `gradeLevelId` or `academicYearId` the org doesn't have is 404 on these writes.
    So is a `familyId` outside the caller's reach (D-053).
  - `Student.gradeLevelId` is the grade in the current academic year, or null. `grades` lists
    every year on record as `{ academicYearId, gradeLevelId }`, earliest year first.
  - The student's `updatedAt` moves when only a grade changes.
  - The current academic year, worked out in the org's timezone, is the year today falls in;
    between years, the one that ended most recently; before the first year starts, that first
    year. There is none only when the org has no academic years.
  - With no academic year at all, giving a student a grade is `422 unprocessable` with
    `fields.gradeLevelId: ['No academic year yet']`, and the `?gradeLevelId` filter returns an
    empty list.
- **Consequences:**
  - During the break between two years, a new student's grade defaults to the year that just
    ended, unless `academicYearId` names the coming one.
  - When a new academic year starts, `Student.gradeLevelId` is null until the student has a
    grade for that year. Year-end promotion is TUI-45.
  - The current year is worked out when read. No flag is stored (D-037).
  - Later tasks can work out whether a student is active from enrolments. Student caps (TUI-74)
    will need a definition of "active".
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-32 (and TUI-45, TUI-74).

## D-056 · 2026-10-11 · Normalised name columns now; families and students in name order

- **Context:** D-026 planned the normalised name columns with a migration in TUI-43 (search).
  TUI-32 creates the tables those columns sit on, and its lists needed an order.
- **Decision:**
  - The normalised columns are created with the tables, not in TUI-43: `families.name_norm`, and
    `first_name_norm` and `last_name_norm` on both `guardians` and `students`. One shared helper
    fills them on every write: lower-case, accents stripped, spaces collapsed.
  - `GET /families` lists by name. `GET /students` lists by last name, then first name. Both use
    the normalised columns, then the id. Case and accents don't change the order; names in other
    scripts sort after Latin ones.
  - The cursor holds every sort key, and works for names in any script.
  - Inside a family, guardians come oldest first and students in name order.
- **Consequences:**
  - This departs from "oldest first by id", the order of the setup, course and class lists
    (D-040, D-043, D-050).
  - TUI-43 needs no backfill. It still adds the search indexes on guardian names and email,
    phone normalisation, `GET /search` and duplicate warnings.
  - The API and the web app must normalise names the same way, so the helper is in
    `packages/shared`.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-32 (and TUI-43).

## D-057 · 2026-10-11 · Family shape, moves, deletes, in-use checks, filters, paths and audit rows

- **Context:** More rules the TUI-32 implementation settled that the handoff didn't cover.
- **Decision:**
  - One Family shape everywhere: list, get, create and update all return the family with its
    `guardians` and `students` nested. There is no `GET /guardians` list. A list page costs a
    fixed number of extra queries, not one per family.
  - A family's name is required, 1–120 characters, and doesn't have to be unique. `address` is
    optional free text, up to 500 characters.
  - A family can move to another home branch (`PATCH` with `branchId`), unlike a class (D-049).
  - `DELETE /families/{familyId}` is refused (`422 unprocessable`) while the family has students.
    Otherwise it soft-deletes the family and its guardians with one `family.deleted` audit row.
  - `DELETE /students/{studentId}` soft-deletes the student and their grade rows with one
    `student.deleted` audit row.
  - A grade level can't be deleted while a non-deleted student grade record uses it, in any
    academic year. A branch can't be deleted while it is a family's home branch. Both are
    `422 unprocessable`. This adds to D-043's grade-level check and D-034's branch-deletion
    rules.
  - `GET /families` filters by `?branchId`. `GET /students` filters by `?familyId`, `?branchId`
    (the family's home branch) and `?gradeLevelId` with an optional `?academicYearId` (default:
    the current academic year, D-055). `?academicYearId` without `?gradeLevelId` is 400. A filter
    id the org doesn't have is 404, as for courses (D-043).
  - The path parameters are `{familyId}`, `{guardianId}` and `{studentId}` (the handoff wrote
    `{id}`).
  - Audit rows: one per write. `student.created` records the grade as `after.grade`.
    `student.updated` records a grade change as `before.grade` and `after.grade`, each
    `{ academicYearId, gradeLevelId }`.
  - A student grade row has the new id prefix `sgr_`.
  - Not built here, as planned: `GET /students/{id}/timeline` (v1.1, D-022),
    `POST /students/promote` (TUI-45) and `GET /search` (TUI-43).
- **Consequences:**
  - Enrolments (TUI-33) must refuse deleting a student who has enrolments. Hard delete and
    anonymising belong to privacy controls (TUI-79).
  - The "unique bank reference per family" in handoff §7 isn't added here. Payments (TUI-38) add
    it, with a backfill for the families that already exist.
  - Student caps and plan limits (TUI-74) aren't enforced when a student is added.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-32 (and TUI-33, TUI-38, TUI-43, TUI-45, TUI-74, TUI-79).
- **Update 2026-10-12 (TUI-33):** Deleting a student is now refused (422) while they have
  enrolments (D-063).

## D-058 · 2026-10-12 · Cross-branch enrolment: the caller must reach both student and class

- **Context:** A family has a home branch (D-051), so staff limited to one branch can't see a
  student whose family's home branch is another one. D-051 and handoff §11 left it to TUI-33 to
  decide how such a student is enrolled in a class at another branch. The owner was asked before
  the build.
- **Decision:** The owner decided "must reach both". Only a caller who reaches both the student
  (people reach, D-053) and the class (classes reach, D-048) can create an enrolment. A
  branch-limited member can't enrol a student whose family's home branch is another one, and
  can't enrol into another branch's class. Cross-branch enrolments go through the owner or staff
  with no branch limit. The owner chose this over "the class's branch decides" (its staff could
  find and enrol any student in the org) and "either side can enrol".
- **Consequences:**
  - On `POST /enrolments`, a `studentId` or `classId` out of the caller's reach is 404 ("Student
    not found" / "Class not found"), as if it didn't exist (the D-048 rule), not 403.
  - No org-wide student lookup was added.
  - This answers the open question in handoff §11 and the point D-051 left to TUI-33.
- **Tasks:** TUI-33.

## D-059 · 2026-10-12 · Who reaches enrolments

- **Context:** Handoff §6 had no Enrolment row. TUI-33 settled which permission the enrolment
  routes need and which enrolments each role reads.
- **Decision:**
  - No new permission. `GET /enrolments` needs `classes:read` and `POST /enrolments` needs
    `classes:write`.
  - Owner, and staff with no branch list (null): every enrolment, read and write.
  - Branch manager and front desk limited to some branches: they read the enrolments in their
    branches' classes, and those of their branches' students (the family's home branch) wherever
    the class is. Either is enough. They enrol only where they reach both sides (D-058). An empty
    branch list reaches none.
  - Teacher: read only, and only the enrolments in the classes they teach, not a student's place
    in another teacher's class. `POST` is 403.
  - Parent: read only, and only their own children's enrolments, including when they filter by a
    class their child shares with others. `POST` is 403.
  - Accountant: 403 on both routes.
  - A `?studentId` or `?classId` filter the caller can't reach is 404 (the D-048 rule).
- **Consequences:**
  - Branch-limited staff read more than they can write: they see a cross-branch enrolment from
    either side but can't make one.
  - Reach passes between the classes, people and enrolment modules as lists of ids through their
    services, so no module reads another's tables (handoff §3). For a branch-limited member,
    `GET /enrolments` first loads their branches' class ids and student ids.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-33.

## D-060 · 2026-10-12 · Teachers reach their classes' students, parents their children's classes

- **Context:** D-048 left a parent's "own children" and D-053 a teacher's "own classes" to
  TUI-33, since both need enrolments. Until now a parent got no classes or sessions and a teacher
  no families or students.
- **Decision:**
  - A teacher reads the students who hold an active enrolment in a class they teach, and those
    students' families with all their guardians. A family's other children (siblings the teacher
    doesn't teach) are left out of the family's `students` list and are 404 on
    `GET /students/{studentId}`.
  - A parent reads the classes that one of their children holds an active enrolment in, and all
    of those classes' sessions.
  - Both stay read only (D-048, D-053).
  - Only active enrolments count: a withdrawn or deleted one doesn't. Dates don't matter, so an
    active enrolment that starts later already counts.
- **Consequences:**
  - A parent's sessions aren't narrowed to the enrolment's dates unless they filter by
    `?studentId` (D-063), so they also see the class's sessions outside those dates.
  - A teacher sees every guardian of a student they teach, with the contact details a guardian
    carries (D-054).
  - This wires the reach D-048 and D-053 left to TUI-33.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-33.

## D-061 · 2026-10-12 · An enrolment carries the student's name and the class's name

- **Context:** D-051 said a child in another branch's class shows on that class's roster. The
  class's branch staff can't open that student's record, so the roster needed the name on the
  enrolment itself.
- **Decision:**
  - The Enrolment shape is `id`, `studentId`, `studentFirstName`, `studentLastName`, `classId`,
    `className`, `courseId`, `branchId` (the class's branch), `startDate`, `endDate`,
    `priceOverride`, `status`, `createdAt` and `updatedAt`.
  - Every enrolment carries the student's name and the class's name, course and branch. This
    follows Session, which carries `className`, `courseId` and `branchId`.
- **Consequences:**
  - Branch-limited staff of the class's branch see a cross-branch student's name on the roster,
    but `GET /students/{studentId}` and the `?studentId` filters (on `/enrolments` and
    `/sessions`) are 404 for them.
  - Home-branch staff see their student's enrolment in another branch's class with its
    `className`, but `GET /classes/{classId}` is 404 for them.
  - The class's teacher does reach that student, their family and guardians (D-060). A branch
    manager or front desk member limited to the class's branch doesn't.
  - Whether the class's branch needs that child's guardian or emergency contacts isn't decided.
    Attendance (TUI-34) should decide. Tracked as an open question in handoff §11.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-33 (and TUI-34).
- **Update 2026-10-12 (TUI-34):** Attendance was built keeping this behaviour. The class's branch
  marks a cross-branch child by name and still gets no guardian or emergency contacts. That is an
  assumption the owner hasn't confirmed, so the question stays open in handoff §11 (D-074).

## D-062 · 2026-10-12 · Enrolment rules: dates, price override, status, duplicates, capacity

- **Context:** Rules the TUI-33 implementation settled for `POST /enrolments` that the handoff
  didn't cover.
- **Decision:**
  - `startDate` is optional. It defaults to today in the org's timezone, or to the class's first
    day when that is later. A start in the past is allowed, for staff recording late.
  - `endDate` is optional. Null means until the class ends.
  - Both dates must fall inside the class's dates: the class's own dates, else its term's. A
    class with no term and no end date is open-ended. Otherwise it is `422 unprocessable` with
    `['Outside the class dates']` on `fields.startDate`, `fields.endDate` or both.
  - An `endDate` before the `startDate` is 400 on `endDate` (D-040), including when the start is
    the default.
  - A class that has already ended only accepts an enrolment dated inside it. Without a
    `startDate` it is 422.
  - `priceOverride` is Money (`{ amount, currency }`) or null. The amount is an integer of 0 or
    more (0 = free). The currency must be the org's, otherwise `400 validation_failed` on
    `priceOverride.currency`, as for a course's `defaultPrice` (D-043). It's stored as two
    columns.
  - `status` is `active` or `withdrawn`. Only `active` is written so far.
  - A student holds at most one active enrolment in a class. A second one is `409 conflict` with
    `fields._: ['Already enrolled']`. A partial unique index on org, student and class, over
    active, non-deleted rows, enforces it.
  - A class with a `capacity` is full when its active enrolments that haven't ended by the new
    enrolment's start date reach the capacity: `422 unprocessable` with
    `fields.classId: ['Full']`. An enrolment that starts later holds its place from the day it is
    made. One with an end date frees its place from the day after. A class with a null capacity
    has no limit.
  - The grade isn't checked. A student can be enrolled in a class of any grade level, whatever
    their own grade, or with none recorded.
- **Consequences:**
  - A withdrawn student can enrol in the same class again later.
  - What period the override price is charged for isn't defined. Price rules (TUI-36) must define
    it, as for a course's default price (D-043).
  - `withdrawn` is for transfers and withdrawals (TUI-46).
  - The capacity check isn't atomic: two requests at the same instant can both take the last
    place.
  - Lowering a class's capacity below its number of enrolments isn't refused. The class is just
    over-full.
  - There is no waitlist (v1.1, handoff §8).
  - Changing a class's dates (`PATCH /classes/{classId}`) or a term's dates doesn't re-check
    existing enrolments, so one can end up outside its class's dates.
  - Price rules (TUI-36) and invoices (TUI-37) read `startDate`, `endDate` and `priceOverride`.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-33 (and TUI-36, TUI-37, TUI-46).
- **Update 2026-10-13 (TUI-36):** The owner decided what the override is charged for. It
  replaces the amount and keeps the basis of the price it replaces: one billing period of the
  class (a term or a month), unless a price rule says per lesson or per pack (D-077, D-082).

## D-063 · 2026-10-12 · Enrolment list and routes, in-use checks, the sessions student filter

- **Context:** More rules the TUI-33 implementation settled that the handoff didn't cover.
- **Decision:**
  - `GET /enrolments` is cursor-paged, oldest first by id, with filters `?studentId` and
    `?classId` (either or both). `?classId` gives a class's roster and `?studentId` a student's
    classes.
  - There is no `GET /enrolments/{id}` and no `DELETE`.
  - `DELETE /classes/{classId}` and `DELETE /students/{studentId}` are refused
    (`422 unprocessable`) while the class or student has any non-deleted enrolment, whatever its
    status. This closes the checks D-049 and D-057 left to TUI-33.
  - `GET /sessions` takes `?studentId` (the handoff wrote `?student`; it is named like the other
    id filters). It returns the sessions of the classes the student holds an active enrolment in,
    only on the dates each enrolment covers (start to end, both included). It stays within the
    caller's own class reach and combines with the other filters. The student must be within the
    caller's people reach (D-053, D-060), otherwise 404.
  - `POST /enrolments` writes one `enrolment.created` audit row with the new row as `after`.
  - Not built here, as planned: `PATCH /enrolments/{id}` (transfer or withdraw, pro-rata; TUI-46)
    and enrolment requests (TUI-47).
- **Consequences:**
  - An enrolment made by mistake can't be removed until TUI-46, and it blocks deleting its class
    and its student until then. TUI-46 should decide whether a mistaken enrolment can be deleted.
  - Home-branch staff asking for their student's timetable don't get the sessions of a class in a
    branch outside theirs.
  - Attendance (TUI-34): who is expected at a session is the active enrolments that cover its
    date.
  - Student caps (TUI-74) can define an "active" student from enrolments (D-055).
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-33 (and TUI-34, TUI-46, TUI-47, TUI-74).
- **Update 2026-10-12 (TUI-34):** Built as stated. A session's roster is the students whose
  active enrolment covers its date, plus anyone already marked at it (D-072). Attendance added no
  in-use checks of its own: the enrolment ones above already cover it (D-075).
- **Update 2026-10-13 (TUI-36):** Deleting a class is also refused (422) while it has a price
  rule of its own (D-085).

## D-064 · 2026-10-12 · One deployed environment for now: production

- **Context:** TUI-24 planned two deployed environments, staging and production. When the deploy
  half of TUI-24 was built, the owner decided: "we will only have prod now. when we start working
  on v1.1 then we will introduce dev env".
- **Decision:** Production is the only deployed environment for now. There is no staging. A dev
  environment comes when work on v1.1 starts.
- **Consequences:**
  - TUI-24's "staging & prod" becomes production only.
  - Changes are checked locally and by the test suite. There is no deployed environment to try
    them on before production.
  - D-002 is unchanged: `ENABLE_DOCS` stays `false` in production. D-002 expected the docs to be
    on in dev and staging. With no staging, Swagger UI and `/api/openapi.json` are available
    locally only.
  - Open, not decided: whether to turn the docs on in production while it is the only deployed
    environment. Tracked as an open question in handoff §11.
- **Tasks:** TUI-24.
- **Update 2026-10-12:** The owner decided the open question: the docs are on in production
  until launch, so `ENABLE_DOCS` is `true` there until then (D-068).

## D-065 · 2026-10-12 · Anything that results in billing goes through the owner

- **Context:** Deploying to Cloudflare creates resources, and some can cost money. The owner set
  a rule: "keep a strict rule. all changes which will results in billing need to go throught me.
  no auto resource upgrade."
- **Decision:**
  - No cloud resource is created, no plan is changed and no paid product is enabled without the
    owner's approval.
  - A deploy never creates resources by itself. Wrangler (4.147) creates missing KV, R2, D1 and
    queue resources on deploy by default, so deploys run with
    `--no-x-provision --no-x-auto-create`. Both flags are built into `pnpm deploy:production`.
  - Never run a bare `wrangler deploy`.
- **Consequences:**
  - A binding to a resource that doesn't exist now fails the deploy instead of creating it. New
    resources are created on purpose, after the owner approves.
  - The rule covers anything that results in billing, not only Cloudflare resources. The CI
    pipeline (the other half of TUI-24) waits for the owner's go-ahead: GitHub Actions minutes on
    a private repo are a billing matter.
- **Tasks:** TUI-24.
- **Update 2026-10-13:** The owner asked for a GitHub Actions workflow that deploys on merge
  (D-076). The repository is public (checked with `gh repo view` on 2026-10-13), not private as
  written above, so standard GitHub-hosted runners cost nothing.

## D-066 · 2026-10-12 · Production on Cloudflare: the resources created

- **Context:** The deploy half of TUI-24 (D-064). Under D-065 the owner first authorised one
  Worker and one D1 database, then approved the R2 bucket and the two queues when asked.
- **Decision:** Production is these resources, all created on 2026-10-12:
  - Worker `edustrux`, at https://edustrux.edustrux-api.workers.dev. It is on workers.dev only:
    there is no custom domain yet, because TUI-3 is still blocked on the domain (D-023). Crons
    `0 * * * *` and `0 3 * * *`. Observability (Workers Logs) is on.
  - D1 database `edustrux`, in Oceania (D-024), id `c2fea74c-1256-4a13-9d77-05f5ac0cc71d`.
    Migrations 0000–0008 (9 files) are applied, which gives 24 tables.
  - R2 bucket `edustrux-files`, location hint Oceania.
  - Queues `edustrux-email` and `edustrux-jobs`. The Worker is the producer and the consumer of
    both, with the same batch size and retries as local: email 10 and 5, jobs 1 and 3.
- **Consequences:**
  - The R2 bucket's region was chosen by Claude during the deploy, not by the owner. It is
    Oceania for the same reason as D-024 (the first centres are in NZ/AU), because a bucket's
    location can't be changed later.
  - The account had no workers.dev subdomain. Wrangler registered `edustrux-api` during the first
    deploy, without prompting. It is free and can be changed in the Cloudflare dashboard; the
    Worker's URL changes with it.
  - No Clerk key is set on the Worker yet. Until the owner sets `CLERK_SECRET_KEY` or
    `CLERK_JWT_KEY`, authenticated routes fail and only `GET /api/v1/health` works.
  - `CLERK_AUTHORIZED_PARTIES` is empty until the web app has an origin, so the token's `azp`
    claim isn't checked.
  - A custom domain follows TUI-3.
  - Not known: the account's Cloudflare Workers plan couldn't be seen, and nothing about the plan
    was changed. The handoff's cost model assumes Workers Paid at $5/month. If the account is on
    the Free plan, the limits differ: for example queue messages are kept for 24 hours, there are
    10,000 queue operations a day, and the daily request and D1 limits fail rather than bill. The
    owner needs to confirm the plan. Tracked as an open question in handoff §11.
- **Tasks:** TUI-24 (and TUI-3).
- **Update 2026-10-12:** The owner set `CLERK_SECRET_KEY` on the Worker, so the "no Clerk key"
  consequence above no longer holds (D-068).
- **Update 2026-10-12:** The Worker's workers.dev address is no longer public. The owner put the
  Worker behind Cloudflare Access until the app is finalised, so every request needs an Access
  sign-in first, including `GET /api/v1/health` (D-069).

## D-067 · 2026-10-12 · Wrangler config: the top level is local, `env.production` is deployed

- **Context:** One config file, `apps/api/wrangler.jsonc`, serves local development, the tests
  and the deployed Worker (D-064).
- **Decision:**
  - The top level is local development and tests: the name `edustrux-local`, a placeholder D1
    id, `ENVIRONMENT=development` and `ENABLE_DOCS=true`.
  - The deployed Worker is `env.production`: `"name": "edustrux"`, `ENVIRONMENT=production`,
    `ENABLE_DOCS=false`, `CLERK_AUTHORIZED_PARTIES=""` and every binding repeated.
  - Vars and bindings aren't inherited by a wrangler environment, so they are repeated. Crons and
    observability are inherited.
  - The scripts are `pnpm db:migrate:production`, then `pnpm deploy:production`. The old `deploy`
    and `db:migrate:remote` scripts are gone.
- **Consequences:**
  - A new var or binding has to be added in both places, or the deployed Worker won't have it.
  - The queue settings are written twice. The `jobs` retry limit is now in three places that must
    stay in step: the code, the top-level config and `env.production`. This extends D-017, which
    named two.
  - The top level is named `edustrux-local`, not `edustrux`, so a bare `wrangler deploy` can't
    aim the local config at the production Worker. It is still never run (D-065).
- **Tasks:** TUI-24.
- **Update 2026-10-12:** `ENABLE_DOCS` under `env.production` is `true` until launch (D-068).

## D-068 · 2026-10-12 · API docs are on in production until launch

- **Context:** D-002 turns Swagger off in production, and D-064 made production the only deployed
  environment. That left no deployed Swagger, which D-064 recorded as an open question (handoff
  §11). The owner hit the 404 at `/api/docs` on the deployed API, was asked, and chose "On until
  launch".
- **Decision:**
  - Swagger UI and the OpenAPI spec are public at `/api/docs` and `/api/openapi.json` on the
    production Worker while production is the only deployed environment.
  - They are turned off again as part of launch hardening: `ENABLE_DOCS` goes back to `false`
    under `env.production` before launch (TUI-86).
  - When the v1.1 dev environment exists (D-064), the docs move there.
- **Consequences:**
  - This overrides D-002's "off in production" until launch. D-002's rule comes back at launch.
  - Anyone with the URL can read the API's shape: its routes and schemas. All data stays behind
    Clerk sign-in.
  - `ENABLE_DOCS` is now `true` under `env.production` (D-067 recorded `false`), and the Worker
    was redeployed on 2026-10-12. Checked on https://edustrux.edustrux-api.workers.dev:
    `/api/docs` returns 200 (Swagger UI), `/api/openapi.json` returns 200 (37 paths, 65
    operations) and `/api/v1/me` without a token returns 401.
  - Turning the docs off again is a manual step: a config change and a redeploy. Nothing does it
    automatically.
  - Also on 2026-10-12, the owner set `CLERK_SECRET_KEY` on the Worker. D-066's "no Clerk key is
    set on the Worker yet" no longer holds. `CLERK_AUTHORIZED_PARTIES` is still empty. A call
    with a real token isn't among the checks above.
- **Tasks:** TUI-24 (and TUI-86).
- **Update 2026-10-12:** The docs are still on (`ENABLE_DOCS` is `true`), but they are no longer
  public. The Worker is behind Cloudflare Access, so "anyone with the URL can read the API's
  shape" doesn't hold while Access is on, and the checks above now return 302 to the Access
  sign-in page from outside. Launch has two manual steps: turn the docs off and remove or narrow
  Access (D-069).

## D-069 · 2026-10-12 · Production is behind Cloudflare Access until the app is finalised

- **Context:** Production is on a public workers.dev address (D-066), with Swagger on there until
  launch (D-068). The owner asked: "can we enable zero trust to restrict the public access until
  we finalise the app. if zer trust is free".
- **Decision:**
  - The production API is behind Cloudflare Access until the app is finalised.
  - The owner enabled Zero Trust on the Cloudflare account and put the Worker `edustrux` behind
    Access, both in the Cloudflare dashboard. Claude did neither step.
- **Consequences:**
  - Nothing on the deployed API is public any more, including the health check and the Swagger
    docs. Checked by Claude from outside on 2026-10-12, with no sign-in, on
    https://edustrux.edustrux-api.workers.dev: `GET /`, `/api/v1/health`, `/api/docs`,
    `/api/openapi.json` and `/api/v1/me` all return 302 to the Cloudflare Access sign-in page.
    Before Access was applied, the same calls returned 404, 200, 200, 200 and 401.
  - This removes the exposure D-068 accepted (anyone with the URL could read the API's shape) for
    as long as Access is on.
  - A browser signs in through Access once. Swagger then works as before, because its calls go to
    the same origin. Clerk sign-in still applies on top for the API's own routes.
  - Non-browser clients (curl, scripts, a mobile app, an uptime monitor) are blocked until they
    send an Access service token. That affects monitoring (TUI-83) if it is set up before launch.
  - Incoming webhooks are blocked while Access covers all traffic. The Paddle, Clerk and Resend
    callbacks need a bypass for their paths when those tasks are built (TUI-71, TUI-73).
  - The Worker's code is unchanged and doesn't check the Access identity (`ctx.access`).
    Cloudflare enforces Access in front of the Worker.
  - The web app will be served by the same Worker, so Access must be removed or narrowed before
    launch, or real customers are blocked. This is a manual step in the Cloudflare dashboard,
    alongside turning the docs off (D-068). Launch task: TUI-86.
  - The Access setup lives only in the Cloudflare dashboard. It isn't in the repo, so nothing in
    `wrangler.jsonc` or a deploy recreates or removes it.
  - Claude can't see the Access configuration: it has no Access tools, and wrangler's login
    doesn't cover Access. So these are not verified:
    - Which Zero Trust plan the owner picked. Cloudflare's setup needs a plan and payment details
      even for the Free plan, which says it won't charge. The owner did this step, so D-065 is
      respected.
    - Who the Access policy lets in.
    - That a signed-in browser reaches Swagger and the API.
    - That the crons and queue consumers still run. They aren't web requests, so they should be
      unaffected, but Cloudflare's docs page doesn't say so and it wasn't tested.
- **Tasks:** TUI-24 (and TUI-71, TUI-73, TUI-83, TUI-86).

## D-070 · 2026-10-12 · A session can be marked from its own day on

- **Context:** TUI-34 had to settle when a session's attendance can be taken. D-046 and D-047 had
  also left a rule open: what happens to things attached to an upcoming session when a holiday or
  a schedule change removes it.
- **Decision:**
  - `PUT /sessions/{sessionId}/attendance` works from the session's own local date on, in the
    org's timezone. Today's session can be marked before its start time, and any past session can
    still be marked.
  - A session dated after today is `422 unprocessable`, with no `fields`.
  - It opens on the day, not at the start time, because teachers take the roll as students
    arrive, a few minutes before the lesson starts.
  - A `cancelled` session can't be marked: `422 unprocessable`.
  - `GET` works for any session the caller reaches, including a future one and a cancelled one.
- **Consequences:**
  - This partly answers the rule D-046 left open, for attendance. A session dated after today has
    no marks, so a holiday or a schedule change that removes it days ahead leaves nothing behind.
  - A same-day gap remains. The generator and `POST /holidays` remove `scheduled` sessions that
    haven't started (D-046, D-047). A session marked today before it starts can still be removed
    that same day by a schedule change or a new holiday. Its attendance rows stay in the table
    and are hidden with the session: the routes only reach marks through a live session. Nothing
    in the generator or in holidays changed.
  - Anything that later counts attendance (reports, make-up credits in TUI-55, per-lesson
    billing) must count only the marks of sessions that still exist.
  - Not taken: opening marking only once the session has started, which would close the gap
    completely. Moving to it later is a tightening.
  - There is no cut-off for marking a past session.
  - Nothing writes `cancelled` yet; TUI-49 will. What happens to marks already on a session when
    it is cancelled or moved is for TUI-49.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-34 (and TUI-49, TUI-55).

## D-071 · 2026-10-12 · Marking attendance merges: one student, some or the whole class

- **Context:** The handoff listed `PUT /sessions/{id}/attendance` with no body. Attendance is
  one-tap on a phone (handoff §8), so one request has to be able to carry one student as well as
  a whole class.
- **Decision:**
  - The body is `{ records: [{ studentId, status }] }`, with 1 to 1000 records. `status` is
    `present`, `absent`, `late`, `excused` or null.
  - PUT merges, it doesn't replace. Each student listed takes the status sent. `status: null`
    clears the mark (soft-deletes its row). Anyone left out keeps theirs. So one tap sends one
    student, and "mark all" sends the class.
  - Each student can be listed once. A repeat is 400 on `records.N.studentId`
    (`['Listed more than once']`). An empty list is 400.
  - It takes no `updatedAt` and has no conflict check: the last mark for a student wins. Marks
    are written as an upsert on the table's unique index (D-075), so two people marking the same
    session at once don't collide.
  - A PUT whose marks are already in place changes nothing, writes no audit row and leaves
    `markedAt` as it was. This is the D-047 rule for saving the same schedule twice.
  - It takes no `Idempotency-Key`: the request is idempotent by itself.
- **Consequences:**
  - A PUT doesn't mean "this is the whole roster". A student left out isn't cleared; clearing
    takes an explicit null.
  - Handoff §5's edit-conflict rule (`updatedAt`) and its `Idempotency-Key` on bulk actions
    don't apply to this route.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-34.

## D-072 · 2026-10-12 · A session's roster: who is expected and who can be marked

- **Context:** D-063 said who is expected at a session is the active enrolments that cover its
  date. TUI-34 settled the rest: who else is on the roster, who can be marked, and what the
  routes return.
- **Decision:**
  - A session's roster is the students whose active enrolment in the session's class covers the
    session's date (start to end, both included: the D-063 rule), plus anyone already marked at
    it.
  - A marked student stays on the roster if their enrolment later stops covering the session.
    Their mark can still be corrected or cleared. Once cleared, they drop off.
  - Only students on the roster can be marked. A `studentId` that isn't on it is
    `422 unprocessable` with `fields['records.N.studentId']: ['Not enrolled for this session']`,
    and the whole request is refused: nobody is marked.
  - That covers a student in another class, one whose enrolment starts later or has ended, an id
    the org doesn't have, and another org's student. None of them is 404, so the response
    confirms nothing about them.
  - `GET` and `PUT` both return 200 with the same shape, `SessionAttendance`:
    `{ sessionId, records }`. Each record is `studentId`, `studentFirstName`, `studentLastName`,
    `status` and `markedAt`. `status` is null until the student is marked. `markedAt` is when the
    status was last set, and null when unmarked.
  - It isn't paged. The whole roster comes back, by last name, then first name, then id, on
    normalised names (D-056).
- **Consequences:**
  - Here an id the caller can't use is 422, where `POST /enrolments` and the list filters answer
    404 (D-058, D-063).
  - Make-up attendees (TUI-55) aren't on the roster yet.
  - "Expected" counts active enrolments only. When withdrawals arrive (TUI-46), a withdrawn
    student drops off the rosters of past sessions they were never marked at. TUI-46 should
    decide whether "expected" should instead be any enrolment that covered the date.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-34 (and TUI-46, TUI-55).

## D-073 · 2026-10-12 · Who reaches attendance: a teacher marks the classes they teach

- **Context:** Handoff §6's "Attendance and notes" row gives each role a reach. The permissions
  `attendance:read` and `attendance:write` already existed; TUI-34 is the first module to use
  them, so it settled what the reach means in the API.
- **Decision:**
  - No new permission. `GET` needs `attendance:read` and `PUT` needs `attendance:write`.
  - A session's attendance is reached through the session, with the class reach of D-048 and
    D-060. A session outside the caller's reach is 404 on both routes.
  - Owner: every session, read and mark.
  - Branch manager and front desk: their branches' sessions, read and mark. A membership with no
    branch list reaches every branch; an empty list reaches none.
  - Teacher: the sessions of the classes they teach, read and mark. Reach follows the class's
    teacher, not the teacher copied onto the session (D-048).
  - Parent: read only (`PUT` is 403), and only their own children's records on a session, never
    the rest of the roster. A session of a class none of their children holds an active enrolment
    in is 404.
  - Accountant: 403 on both routes.
- **Consequences:**
  - This is the first route a teacher writes to. Class and session routes stay read-only for
    them (D-048).
  - It matches the handoff §6 row, so nothing differs from the plan. The rest of that row (lesson
    notes, and a parent reporting an absence) isn't built here.
  - A parent reaches a session through any child with an active enrolment in the class, whatever
    its dates (D-060). When none of their children is on that session's roster, `records` is
    empty.
  - The teacher today view (TUI-57) uses these routes.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-34 (and TUI-57).

## D-074 · 2026-10-12 · Cross-branch children are marked by name (assumption, for the owner to confirm)

- **Context:** D-061 and handoff §11 left a question to TUI-34. Branch-limited staff of a class's
  branch see a child from another home branch by name, but can't open the student or the family,
  so they have no guardian or emergency contacts for that child. Should they get them?
- **Decision:** Attendance was built to keep today's behaviour:
  - A roster record carries the student's id and name only.
  - Branch-limited staff of the class's branch can mark a child whose home branch is elsewhere.
  - They still can't open that student or family: `GET /students/{studentId}` stays 404 for
    them, and they get no guardian or emergency contacts.
  - The class's teacher does reach that student, their family and guardians (D-060).
  - **Assumption: the commander stated this before the build and the owner didn't object, but
    the owner hasn't decided it. The owner needs to confirm it at review.**
- **Consequences:**
  - No reach was widened and no contact details were added to the roster.
  - The open question in handoff §11 stays open, with a note that attendance was built this way.
  - Giving the class's branch those contacts later means a new decision.
- **Tasks:** TUI-34.

## D-075 · 2026-10-12 · Attendance routes, table, audit row and in-use checks

- **Context:** More rules the TUI-34 implementation settled that the handoff didn't cover.
- **Decision:**
  - The routes are `GET` and `PUT /sessions/{sessionId}/attendance`. The path parameter is
    `{sessionId}` (the handoff wrote `{id}`), as on `GET /sessions/{sessionId}` (D-050).
  - A new `attendance` table holds one row per student marked at a session: `session_id`,
    `student_id` and `status`, plus the common columns. A student with no row hasn't been marked.
    Clearing a mark soft-deletes its row.
  - `status` is `present`, `absent`, `late` or `excused`.
  - A partial unique index on org, session and student, over non-deleted rows, allows one mark
    per student at a session. There is also an index on org and student.
  - An attendance row has the new id prefix `att_`. The API doesn't expose the id.
  - A PUT that changes something writes one `attendance.marked` audit row for the whole request,
    not one per student (the D-045 rule). Its entity type is `session` and its entity id is the
    session's. `before` and `after` are `{ records: [{ studentId, status }] }`, listing only the
    students whose status changed, with the old and the new status (null = unmarked).
  - No in-use checks were added. A student or class with attendance already has enrolments, and
    those block deleting it (D-063).
- **Consequences:**
  - This is the first audit row that stores only what changed. The general option of storing only
    the changed fields in `before`/`after`, and archiving old audit rows, stay deferred (D-045,
    TUI-79). The TUI-79 note asked for that option to be decided before attendance marking was
    built; it is still open.
  - The in-use reasoning holds while an enrolment can't be deleted. If TUI-46 lets a mistaken
    enrolment be deleted (D-063), it must deal with the marks already made under it.
  - Nothing sets a status automatically. Whether an absence notice marks a student `excused` is
    for TUI-54.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-34 (and TUI-46, TUI-54, TUI-79).

## D-076 · 2026-10-13 · Merging to main deploys production

- **Context:** Production was deployed by hand (D-067), so it fell behind `main`: the attendance
  work (#23, migration 0009) was merged on 2026-10-13 and not deployed. The owner asked "are we
  deploying the app to cloudflare when we merge pr to main?", was told no, and asked: "can we have
  a yaml as a github action".
- **Decision:**
  - A GitHub Actions workflow, `.github/workflows/deploy-production.yml`, runs on every push to
    `main`, which is every merged pull request. In one job it installs from the lockfile, then
    runs `pnpm typecheck`, `pnpm test`, `pnpm db:migrate:production` and
    `pnpm deploy:production`, in that order. A step that fails stops the ones after it.
  - It uses the same two scripts as a deploy from a machine, so the D-065 flags still apply: a
    deploy from the workflow never creates resources.
  - It needs two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The
    owner creates the token and sets both. Claude doesn't handle either value.
  - Chosen by Claude while building it, not stated by the owner:
    - A merge that only changes `docs/`, Markdown files or `.claude/` doesn't start it.
    - It can be started by hand from the Actions tab, and deploys only when run on `main`.
    - One deploy runs at a time, and a run that has started isn't cancelled by a newer merge.
    - The three actions it uses are pinned to a commit, and the Cloudflare token is given only
      to the migrate and deploy steps.
    - Nothing runs on pull requests.
- **Consequences:**
  - A merge is now a production release. Merged migrations are applied to the production D1 with
    no person in between: there is no staging (D-064) and no approval step.
  - Migrations run before the deploy. If the deploy then fails, the database is ahead of the
    running code until a later run succeeds, so a migration has to work with the Worker version
    before it.
  - The checks run after the merge, not before it. A failing test stops the deploy, but `main` is
    already broken by then. Checks on pull requests would catch it earlier and aren't set up.
  - Until the owner sets the two secrets, every run fails at the migration step and nothing is
    deployed. The first run is the one started by merging this workflow, and it also releases
    what `main` already holds: migration 0009 and the attendance routes.
  - A long-lived Cloudflare token that can deploy to the account now sits in GitHub's secrets.
    The repository is public, so the workflow has no pull-request trigger: a pull request from a
    fork can't start it or reach the token. Its run logs are public.
  - Billing (D-065): the repository is public, so GitHub-hosted runners are free. If it is made
    private, each run uses the plan's Actions minutes; the job is capped at 15 minutes.
  - Not verified: the workflow hasn't run on GitHub. Its steps were run from a clean clone on
    2026-10-13: the install, typecheck, the tests (362 passed), a local migration with no
    terminal attached, and a dry run of the production deploy. The real migrate and deploy steps
    need the token.
  - The token needs three account permissions and nothing else: Workers Scripts: Edit, D1: Edit
    and Queues: Edit. Cloudflare's docs say a deploy needs no permission on the resources a
    Worker is bound to, and that querying a D1 database does. Wrangler 4.147's code shows a
    deploy lists the queues and rewrites each consumer's settings. Not tested with a real token:
    the first run will show whether that is right. A custom domain (TUI-3) will add Zone →
    Workers Routes: Edit for its zone.
  - Access (D-069) is set in the Cloudflare dashboard and a deploy shouldn't change it. No deploy
    has run since it was turned on, so check after the first run that the address still goes to
    the Access sign-in page.
- **Tasks:** TUI-24.

## D-077 · 2026-10-13 · What a price is charged for: one billing period of the class

- **Context:** D-043 and D-062 left open what a course's `defaultPrice` and an enrolment's
  `priceOverride` are charged for, and said price rules (TUI-36) must define it. The owner was
  asked during the build.
- **Decision:** The owner decided:
  - A course's `defaultPrice` and an enrolment's `priceOverride` are for one billing period of
    the class: a term for a class in a term, a month for a class with no term (D-036).
  - Price rules add per-lesson and pack pricing.
  - An override replaces the amount and keeps the basis of the price it replaces.
- **Consequences:**
  - This settles the point D-043 and D-062 left open.
  - A course with both kinds of class charges its default price per term on one and per month on
    the other. A `per_term` and a `per_month` price rule can sit side by side on the course to
    price them apart (D-081).
  - The API descriptions of `Course.defaultPrice` and `Enrolment.priceOverride` now say what
    they are charged for.
  - Turning a price into an invoice amount is TUI-37 (D-082).
- **Tasks:** TUI-36 (and TUI-37).

## D-078 · 2026-10-13 · Packs and free trial lessons

- **Context:** TUI-36 covers packs and a free trial, and the handoff didn't say what either
  means. The owner was asked during the build.
- **Decision:** The owner decided:
  - Pack: N lessons for one price, invoiced up front. The next pack is invoiced when those
    lessons are used.
  - Free trial: the first N lessons of a student's enrolment aren't charged.
  - TUI-36 stores both on the price rule. Invoice generation (TUI-37) counts the lessons.
- **Consequences:**
  - Nothing counts lessons yet. A rule with a pack size or a free trial only stores the numbers
    until TUI-37.
  - TUI-37 needs a pack balance per enrolment, to know when the next pack is invoiced.
  - The limits on both numbers are in D-081.
- **Tasks:** TUI-36 (and TUI-37).

## D-079 · 2026-10-13 · Bundles are built with discounts (TUI-58), not with price rules

- **Context:** The TUI-36 task listed per-subject pricing and bundles (a price by number of
  subjects: 1, 2, 3+; grade bundles like "Year 10 core"), from handoff §7. The owner was asked
  during the build.
- **Decision:** The owner decided:
  - Bundles aren't built in TUI-36. A price rule prices each enrolment on its own.
  - TUI-58 builds bundles next to the multi-class and sibling discounts, as an amount off or a
    fixed bundle price, so a bundle and a multi-class discount can't both apply.
- **Consequences:**
  - Bundles stay in the MVP. The work moved from TUI-36 (P2) to TUI-58 (P3), and handoff §7 and
    §8 say where they are built.
  - Until TUI-58, a student taking several subjects is charged each class's own price.
  - TUI-58 must build bundles, and the rule that a bundle and a multi-class discount can't both
    apply.
- **Tasks:** TUI-36, TUI-58.

## D-080 · 2026-10-13 · One tax rate is the org's default; a price rule can name another

- **Context:** D-039 gave an org zero or more named tax rates, but nothing said which rate
  applies to a price. Price rules (TUI-36) needed that. The owner was asked during the build.
- **Decision:** The owner decided:
  - One tax rate is marked as the org's default and applies to every price.
  - A price rule can name a different one, for example a zero-rated one.
- **Consequences:**
  - Tax rates gained an `isDefault` flag and price rules an optional `taxRateId`. This extends
    D-039.
  - How the flag is set and moved is in D-084. Which rate a price gets is in D-082.
  - Invoices (TUI-37) apply the tax.
- **Tasks:** TUI-36 (and TUI-37).

## D-081 · 2026-10-13 · Price rule shape: one target, a basis and a price

- **Context:** The handoff listed a `price_rules` table and four routes with no fields. TUI-36
  settled what a rule holds and which rules can exist together.
- **Decision:**
  - A rule prices exactly one target: one class (`classId`), one course's classes (`courseId`)
    or, with neither, every class in the org (org-wide). Sending both `courseId` and `classId` is
    400 on `classId`.
  - There are no grade-level or subject targets: a course is already subject × grade. They could
    be added later without changing existing rules.
  - `basis` is `per_term`, `per_month`, `per_lesson` or `pack`. `per_term` only fits a class in a
    term and `per_month` only a class with no term (D-036). `per_lesson` and `pack` fit both.
  - `price` is Money. The amount is an integer of 0 or more (0 = free). The currency must be the
    org's, otherwise `400 validation_failed` on `price.currency`, as for a course's
    `defaultPrice` (D-043). It's stored as two columns.
  - `packLessons` is an integer from 2 to 200. It is required when the basis is `pack` and
    refused otherwise (400 on `packLessons`).
  - `freeTrialLessons` is an integer from 0 to 20, default 0, allowed on any basis.
  - `taxRateId` is optional. Null means the org's default tax rate (D-080). To charge no tax on
    one price while the org has a default, name a 0% rate.
  - A rule has no name. Clients label it from its target and basis.
  - A rule keeps its target and basis: `PATCH /price-rules/{priceRuleId}` takes only `price`,
    `packLessons`, `freeTrialLessons` and `taxRateId`, and ignores `courseId`, `classId` and
    `basis` if sent. To change them, delete the rule and add it again, as for rooms (D-034),
    terms (D-037) and courses (D-043).
  - On PATCH, `packLessons` for a rule that isn't a pack is 400, and so is `packLessons: null`.
    `taxRateId: null` goes back to the org's default.
  - On POST, a `courseId`, `classId` or `taxRateId` the org doesn't have (unknown, deleted,
    another org's or an empty string) is 404. So is such a `taxRateId` on PATCH.
  - A class's rule must be on a basis the class is billed on. `per_month` for a class in a term,
    or `per_term` for a class with no term, is `422 unprocessable` with `fields.basis`
    (`['The class is in a term']` or `['The class has no term']`).
  - One target can't have two rules that could price the same class: `409 conflict` with
    `fields._: ['Taken']`. So a target has at most one rule that fits classes in a term and at
    most one that fits classes with no term. `per_term` and `per_month` can sit side by side on a
    course or org-wide. `per_lesson` or `pack` excludes every other rule on that target. A class
    has at most one rule. Two partial unique indexes enforce it, and deleting a rule frees its
    place.
- **Consequences:**
  - There is no price history and no effective dates (price history is v1.1, handoff §8).
    Changing a rule changes what future invoice runs charge.
  - TUI-37 must copy the price onto the invoice line, so later rule changes or deletes don't
    change issued invoices.
  - If the org's currency changes, existing price rules keep the currency they were saved with,
    as course prices do (D-043).
  - Two requests at the same instant that both add a clashing rule hit the unique index, and one
    gets a 500, not a 409.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-36 (and TUI-37).

## D-082 · 2026-10-13 · Which price applies: the most specific one wins

- **Context:** A class can be priced by its own rule, its course's rule, its course's default
  price and the org-wide rule, and an enrolment can carry an override. TUI-36 settled the order.
  It is built as a resolver inside the billing module for invoice generation (TUI-37), not as an
  endpoint.
- **Decision:**
  - The most specific price wins, in this order:
    1. the class's own rule;
    2. the course's rule that fits the class (in a term or not);
    3. the course's `defaultPrice`, charged per term or per month by the kind of class (D-077),
       with no free trial;
    4. the org-wide rule that fits the class.
  - A rule that doesn't fit the class's kind is skipped and the search goes on.
  - A course's default price beats the org-wide rule because it is about that course. A course's
    rule beats the course's default price.
  - An enrolment's `priceOverride` replaces only the amount (D-077). The basis, pack size, free
    trial and tax rate stay those of the price it replaces. If nothing else prices the class, the
    override is charged per billing period (per term or per month) with no trial.
  - Tax: the rule's `taxRateId`, else the org's default tax rate, else none. A course default
    price and a bare override use the org's default (D-080).
  - If no rule fits, the course has no default price and the enrolment has no override, the
    enrolment has no price (null).
  - For one enrolment the resolver returns the price terms: `price`, `basis`, `packLessons`,
    `freeTrialLessons`, `taxRateId`, `source`, `priceRuleId` and `overridden`. `source` is
    `class_rule`, `course_rule`, `course_default` or `org_rule`, or null when only an override
    prices the class.
- **Consequences:**
  - It returns the price terms only, not an amount for a term or a month. No endpoint returns a
    resolved price.
  - TUI-37 turns the terms into amounts: it counts lessons for per-lesson prices, packs (a pack
    balance per enrolment, D-078) and free-trial lessons, works out pro-rata for per-term and
    per-month prices, and applies the tax from `taxRateId`.
  - TUI-37 decides what invoice generation does with an enrolment that has no price.
  - The month-based "generate invoices" path is still undecided (D-036).
  - Transfers and withdrawals with pro-rata (TUI-46) read the same price terms.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-36 (and TUI-37, TUI-46).

## D-083 · 2026-10-13 · Who reaches price rules (assumption, for the owner to confirm)

- **Context:** Handoff §6's "Fees and payments" row gives each role a reach over billing. The
  permissions `billing:read` and `billing:write` already existed; price rules are the first
  routes to use them, so TUI-36 settled what the reach means for a rule.
- **Decision:**
  - No new permission. `GET /price-rules` needs `billing:read`; `POST`, `PATCH` and `DELETE`
    need `billing:write`.
  - Owner, branch manager and front desk: read and write.
  - Accountant: read only, 403 on writes.
  - Teacher: no billing permission, 403 on every route.
  - Parent: 403 on every route, `GET` too. A parent holds `billing:read` with the `own` scope,
    which is for their own invoices. Price rules belong to no family.
  - An org-wide rule and a course's rule have no branch. A branch manager or front desk member
    limited to some branches still adds, changes and deletes them for the whole org, as with
    courses (D-041).
  - A class's rule goes with its class's branch. The rule stores the class's branch, copied when
    the rule is added; a class can't change branch (D-049).
  - Staff limited to some branches don't see other branches' class rules in the list. They get
    404 on `PATCH` and `DELETE` of such a rule, on `?classId` for such a class, and on `POST`
    with a class outside their branches, as for the class itself (D-048).
  - **Assumption: recorded from the implementation. The roles follow the handoff §6 row, but the
    owner hasn't decided who writes price rules, or that org-wide and course rules ignore a
    member's branch limit. The owner needs to confirm it at review.**
- **Consequences:**
  - Front desk and branch managers can change prices for the whole org. They can already set a
    course's default price (D-041) and an enrolment's override (D-062).
  - Restricting writes later means a different permission or scope on these routes and a new
    decision. Tracked as an open question in handoff §11.
  - Teachers can read `priceOverride` on the enrolments of their classes (D-059, D-061),
    although they have no billing access. That is existing behaviour from TUI-33 and wasn't
    changed here.
- **Tasks:** TUI-36.

## D-084 · 2026-10-13 · The default tax rate: set explicitly, at most one per org

- **Context:** The owner decided one tax rate is the org's default (D-080). TUI-36 settled how
  the flag is set and moved.
- **Decision:**
  - `TaxRate` has `isDefault`. `POST /tax-rates` takes it as optional (default false) and
    `PATCH /tax-rates/{taxRateId}` takes it.
  - It is explicit: a new rate is the default only when `isDefault: true` is sent. The first
    rate doesn't become the default by itself.
  - No default means no tax on prices that don't name a rate.
  - An org has at most one default among its non-deleted rates. A partial unique index enforces
    it.
  - Making a rate the default, on POST or PATCH, takes the flag off the rate that had it, in the
    same write. It writes one audit row, for the rate that was asked about. The rate that lost
    the flag gets a new `updatedAt`.
  - `isDefault: false` on PATCH leaves the org with no default. Deleting the default rate is
    allowed and leaves no default.
  - Writes stay owner-only (`org:write`) and reads `org:read`, as in D-039.
- **Consequences:**
  - An org that adds tax rates and marks none as the default charges no tax, except on prices
    whose rule names a rate.
  - The rate that lost the flag has no audit row of its own.
  - Two requests at the same instant that both make a rate the default hit the unique index, and
    one gets a 500, not a 409.
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-36 (and TUI-37).

## D-085 · 2026-10-13 · Price rule routes, table, audit rows and in-use checks

- **Context:** More rules the TUI-36 implementation settled that the handoff didn't cover.
- **Decision:**
  - The routes are `GET|POST /price-rules` and `PATCH|DELETE /price-rules/{priceRuleId}`. The
    path parameter is `{priceRuleId}` (the handoff and the task file wrote `{id}`), following the
    other routes. There's no `GET /price-rules/{priceRuleId}`, as in the handoff's list.
  - `GET /price-rules` is cursor-paged, oldest first by id, with filters `?courseId` and
    `?classId`: that course's or that class's own rules. A filter id the org doesn't have is 404
    (D-043, D-050), and so is a class outside the caller's reach (D-083).
  - `POST` returns 201. `PATCH` takes `updatedAt` (stale is 409), and one that sends only
    `updatedAt` returns the rule unchanged (D-034). `DELETE` is a soft delete and returns 204.
  - A new `price_rules` table holds `course_id`, `class_id`, `branch_id` (the class's branch,
    D-083; the API doesn't expose it), `basis`, `price_amount`, `price_currency`,
    `pack_lessons`, `free_trial_lessons` (default 0) and `tax_rate_id`, plus the common columns.
    Two partial unique indexes over non-deleted rows hold the one-rule-per-target rule (D-081).
  - `tax_rates` gained `is_default` (default false) and a partial unique index for it (D-084).
  - A price rule has the new id prefix `prr_`.
  - Each write writes one audit row: `price_rule.created`, `price_rule.updated` or
    `price_rule.deleted`, with entity type `price_rule`.
  - In-use checks, each `422 unprocessable`:
    - `DELETE /tax-rates/{taxRateId}` is refused while a price rule names the rate. This is the
      check D-039 left to TUI-36.
    - `DELETE /courses/{courseId}` is also refused while a price rule prices the course. This
      extends D-050's course check.
    - `DELETE /classes/{classId}` is also refused while the class has a price rule of its own.
      The rule isn't deleted with the class. This extends D-049 and D-063.
  - Deleting a price rule has no in-use check: invoices don't exist yet.
- **Consequences:**
  - A course or a class with a price rule is deleted in two steps: its rule first.
  - `DELETE /tax-rates/{taxRateId}` can now return 422, which it couldn't before.
  - Bundles aren't part of these routes (D-079).
  - Assumption: recorded from the implementation; the owner hasn't stated these rules.
- **Tasks:** TUI-36 (and TUI-37).
