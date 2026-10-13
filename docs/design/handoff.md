# Tuition Centre App: Project Handoff

Handoff notes for continuing this project in Claude Code. They cover the decisions already made, the MVP scope, the architecture, the data model and the API.

Last updated: 2026-10-13 · Owner: Anojan (Auckland, NZ)

> This is the living design spec, kept up to date by `/update-design-docs`. Decisions made during
> the build are logged in [decisions.md](decisions.md) and referenced here as D-xxx.

---

## 1. Product summary

A global SaaS for running tuition centres, from a solo tutor up to a centre with several branches. It's built around **organisations**: a solo tutor is an org with one teacher, and features appear as the org grows.

- **Customers:** academic tuition centres teaching school subjects by grade or year level, music schools, language and cultural schools (e.g. Tamil schools), and dance studios.
- **Market:** global from day one. Currency, timezone, date format, tax, terms and grade names are all per-org settings.
- **Money:** fees are **recorded, not processed**. The app works out what each family owes, issues invoices and reminders, and staff record payments made outside the app (cash, bank transfer, cheque). No online payments for now.
- **Tax:** each org configures it. Zero or more named rates, inclusive or exclusive, with a tax number shown on invoices. One rate can be the org's default, applied to every price that doesn't name another (D-080).
- **Paid add-ons:** WhatsApp, SMS and all AI features. **None of these are in the base app.**

### Product principles
1. Everything belongs to an organisation.
2. Global from day one: nothing locale-specific is hard-coded. Language and formatting are separate: the UI is English only for the MVP but built i18n-ready, and the org's locale is its formatting region (numbers, money, dates), not a language (D-015).
3. Tax is configurable, and "no tax" is a valid setting.
4. Money is recorded, not processed.
5. Parents use their phones: every parent action works on mobile web without installing an app.
6. Make-up lessons, cancellations and credits are first-class workflows.
7. AI drafts and suggests, and a person confirms (paid add-on only).
8. Templates per school type (tuition, music, language/cultural, dance) on one engine. Academic tuition comes first; the others follow (D-028).

---

## 2. Business decisions

| Topic | Decision |
|---|---|
| Name and domain | **EduStrux**, at edustrux.com. Domain registration by the owner is pending (D-023). |
| Plans | **Solo US$9.90/month** (up to 30 students), **Small US$24.90/month** (up to 150 students), **Talk to us** (custom quote for larger centres). Prices may rise later. |
| Annual billing | At launch, two months free: **Solo US$99/year**, **Small US$249/year** (about 17% off) (D-027). |
| Displayed currency | USD base. Hand-set round local prices for NZD, AUD and GBP in Paddle; other countries see Paddle's automatic local-currency conversion. Exact amounts are set during Paddle setup (D-027). |
| Plan mix assumption | 4 Solo for every 1 Small |
| First-year goal | **NZ$500/month profit** |
| Subscription billing | Paddle (merchant of record, handles global sales tax; 5% + $0.50 per transaction) |
| Add-ons | WhatsApp, SMS and AI are paid add-ons, not in the base app. Pricing still open (packs or pay-as-you-go). WhatsApp costs vary a lot by region, so price packs by region. |
| Large-class attendance (QR/ID check-in, 100+ students) | Only as a custom feature if a large client signs. Not planned. |
| Spending | Anything that results in billing goes through the owner. No cloud resource is created, no plan changed and no paid product enabled without the owner's approval (D-065). |

### Rough unit economics (USD)
- **Fixed costs at launch:** about $6.25/month. That's Cloudflare Workers Paid at $5 plus the domain at $15/year. Clerk, Resend and monitoring start on free tiers. Which Workers plan the account is on isn't confirmed yet (D-066, §11).
- **Average profit per centre** at the 4:1 mix is about **$11.20/month**. Paddle's fee is the biggest variable cost, taking about 10% of a $9.90 Solo plan.
- **Target:** NZ$500 is about US$281/month (at 1.78 NZD per USD), which needs about **26 centres** (about 21 Solo and 5 Small).
- **Costs you'll likely add before ~26 centres:**
  - Resend Pro ($20): above the free 3,000 emails/month.
  - Clerk Pro ($25, or $20 billed annually): needed for staff MFA.
  - With both, the target is about **30 centres**.
- **Annual billing** (decided, D-027): one payment a year saves about $5.50/year per customer in Paddle's $0.50 fixed fee, brings cash up front and lowers churn.
- **Avoid Clerk's B2B add-on ($100/month).** Keep orgs, roles and memberships in our own database.
- **Parents are Clerk users too** (D-021). At ~26 centres with up to 150 students each, that's roughly 4,000 parents at most, well within Clerk's 50k free monthly retained users.

---

## 3. Tech stack (decided)

| Layer | Choice |
|---|---|
| Repo | One monorepo: pnpm workspaces + Turborepo |
| Hosting | **Cloudflare.** One Worker serves the React build (static assets) and the API on the same domain. One deployed environment for now, production (D-064, §4). |
| API | **Node-compatible TypeScript on Cloudflare Workers, using Hono.** Zod validation, OpenAPI generated from routes. |
| API docs | Swagger UI at `/api/docs`, spec at `/api/openapi.json`, generated by `@hono/zod-openapi`. On locally. On in production until launch, while it is the only deployed environment; off there from launch (D-002, D-068). Not public there: production is behind Cloudflare Access until launch (D-069). |
| Frontend | **React + Vite**, TanStack Query, typed API client. Built so a **React Native (Expo)** app can be added later, reusing the shared client and schemas. |
| Auth | **Clerk** for sign-in and sessions only, for staff and parents (parents sign in passwordless by email code or magic link, D-021). Orgs, memberships and roles live in D1. |
| Database | **Cloudflare D1** (SQLite). **One shared database, with `org_id` on every row.** Launch region Oceania (`oc` location hint, D-024). |
| Search | Prefix search on normalised (lower-case, accent-stripped) name columns with `org_id`-leading indexes, plus exact email/phone. SQLite FTS5 only if needed later (D-026). |
| ORM | Drizzle (schema + migrations for D1) |
| Files | Cloudflare R2. Keys under `orgs/{orgId}/`, short-lived signed links. The bucket is in Oceania, like the database (D-066). |
| Background work | Cloudflare Cron Triggers (schedules) + Cloudflare Queues (email, bulk jobs) |
| Email | Resend |
| PDFs | Server-side with **Cloudflare Browser Rendering**: headless Chrome renders HTML/CSS templates to PDF. Batches run through the `jobs` queue (D-025). |
| SMS/WhatsApp | Not in the MVP (paid add-on later) |
| Domain | edustrux.com, fixed $15/year (D-023). Until it is registered, production is on a workers.dev address (D-066). |

### Why one shared D1 database (not one per org)
A Cloudflare Worker can only bind to D1 databases declared in its config ahead of time. It **can't pick a different database per tenant at run time**. Database-per-tenant on D1 means falling back to the D1 REST API, which other teams reported as slow and rate-limited.

So the plan is:
- One shared D1 database. Every table except `users` has `org_id`, and every index starts with `org_id`.
- `org_id` scoping is enforced in **one place**: org middleware plus a repository layer that is the only code allowed to touch D1. Every repository function takes `orgId`.
- **Capacity:** at roughly 8 MB per centre per year, the 10 GB D1 limit holds 1,000+ centres for a year. That's far beyond the ~30-centre target, at no extra cost. The Workers Paid plan includes 5 GB storage, 25B row reads and 50M row writes per month.
- **Growth path:** if needed later (near 5–10 GB, write contention, or per-region data), move to **Durable Objects with SQLite per org** or to Postgres. Keeping all data access behind the org-scoped repository layer keeps that migration contained.
- **Region:** one shared D1 database lives in one region. The launch region is **Oceania** (`oc` location hint), near the first NZ/AU centres. Writes from other regions are slower, which is acceptable for admin work; D1 read replicas can serve reads closer to users later. A per-region database is needed only when a customer requires data residency (the v1.1 "choose data region" feature) (D-024).

### Monorepo layout
```
tuition-app/
├─ apps/
│  ├─ web/        React + Vite (staff app + parent portal; built into the Worker's static assets)
│  ├─ api/        Hono on Cloudflare Workers (+ cron handlers, queue consumers)
│  └─ mobile/     React Native (Expo), later
├─ packages/
│  ├─ shared/     Zod schemas, types, typed API client (used by web + mobile)
│  └─ db/         Drizzle schema + D1 migrations
└─ turbo.json
```

Inside `apps/api`, organise **by module, not by layer**: orgs, branches, calendar, people, curriculum, classes, enrolment, attendance, learning, billing, comms, portal, reports, platform. Each module owns its routes, services and repositories. Modules call each other only through services, never by reading each other's tables. Any module can be split out later if needed.

### No microservices
Microservices would add deploy, debugging and data-consistency overhead with no benefit at this stage. Reasons to split something out later: heavy or slow processing (bulk PDFs, the AI add-on), an isolated outside integration (WhatsApp webhooks), or a second developer owning a module.

---

## 4. Architecture

```
 Staff web app        Parent portal (PWA)       Mobile app (later)
   React+Vite           same React app           React Native
        \                    |                        /
         \                   |                       /
     ┌──────────────── Cloudflare Worker (one deploy) ────────────────┐
     │  Static assets   │  Hono API /api/v1          │ Background jobs │
     │  (React build)   │  Clerk token → org → role  │ Cron + Queues   │
     │                  │  modules: people, classes, │                 │
     │                  │  attendance, fees, msgs,   │                 │
     │                  │  reports                   │                 │
     └──────────────────────────────────────────────────────────────────┘
          |                     |                      |
      D1 database           R2 files                 Clerk
   (shared, org_id)    (orgs/{orgId}/…)        (identity only)
          |
   Outside services: Resend (email) · Paddle (your billing) · Browser Rendering (PDFs) · [later: WhatsApp, SMS, AI add-ons]
```

### Request pipeline (every API call)
1. The client calls `/api/v1/...` with the Clerk session (cookie on web, `Authorization: Bearer` on mobile). Staff and parents take the same path; a parent is a Clerk user with a `parent` membership (D-021).
2. **Auth middleware** verifies the Clerk token at the edge (cached public keys) and gets the user id.
3. **Org middleware** reads `orgId` from the URL path (no subdomains, D-020) and loads the membership from D1. If the user isn't a member, it returns **404**, so we never confirm that an org id exists.
4. **Permission check:** each route declares one permission (e.g. `invoices:write`). The membership's role and branch scope decide.
5. **Validation:** shared Zod schemas parse the body and query.
6. **Module service** applies the business rules (pricing, make-up policy, clashes).
7. **Repository layer** is the only D1 access. It always adds `org_id = ?`. Writes run as one D1 batch together with an audit-log row. A write that adds or removes many sessions gets one audit row with the counts, not one per session (D-045). Marking a session's attendance gets one row for the request, listing the students whose status changed, not one per student (D-075).
8. Slow side effects (emails, bulk invoices, PDF batches) go to a Queue, and the API returns immediately. A single PDF (e.g. `GET /invoices/{id}/pdf`) takes a second or two and is rendered in the request (D-025).

### Environments and deploy

| Environment | Where | Notes |
|---|---|---|
| Local | `wrangler dev` and the test suite, with a local D1 | API docs on |
| Production | Worker `edustrux` at https://edustrux.edustrux-api.workers.dev | D1 `edustrux` and R2 `edustrux-files` (both Oceania), queues `edustrux-email` and `edustrux-jobs`, the hourly and daily crons, Workers Logs (D-066). API docs on until launch (D-068). Behind Cloudflare Access until launch: nothing is public (D-069). |

- **One deployed environment for now.** There is no staging. A dev environment comes when work on v1.1 starts (D-064).
- **Address:** workers.dev until the domain is registered (TUI-3, D-023). The `edustrux-api` part is the account's workers.dev subdomain and can be changed in the Cloudflare dashboard (D-066).
- **Deploy:** apply new migrations, then deploy (`pnpm db:migrate:production`, `pnpm deploy:production`). A deploy never creates resources: a binding to one that doesn't exist fails it. New resources, plan changes and paid products need the owner's approval first (D-065).
- **Config:** one wrangler config holds both. Its top level is local; `env.production` is the deployed Worker, with its vars and bindings repeated (D-067).
- **Access gate:** the production Worker is behind Cloudflare Access until the app is finalised. The owner set it up in the Cloudflare dashboard on 2026-10-12 (D-069).
  - Nothing is public, including `GET /api/v1/health` and the API docs. Without an Access sign-in, a request gets a 302 to the Access sign-in page (checked on `/`, the health check, the docs, the spec and `/api/v1/me`).
  - A browser signs in through Access once, then Swagger works as before. Clerk sign-in still applies on top for the API's own routes.
  - Non-browser clients (curl, scripts, an uptime monitor) need an Access service token. This affects monitoring if it is set up before launch (TUI-83).
  - Incoming webhooks are blocked while Access covers all traffic. The Clerk, Resend and Paddle paths need an Access bypass when they are built (TUI-71, TUI-73).
  - Cloudflare enforces Access in front of the Worker. The Worker's code doesn't check the Access identity.
  - The setup lives only in the Cloudflare dashboard, not in the repo. The wrangler config and a deploy don't recreate or remove it.
  - Not verified: the Zero Trust plan, who the policy lets in, that a signed-in browser gets through, and that the crons and queue consumers still run (D-069).
- **API docs:** Swagger UI and the spec are on in production until launch. While Access is on they aren't public; without it, anyone with the URL can read the routes and schemas. All data stays behind Clerk sign-in. Once the v1.1 dev environment exists, the docs move there (D-068, D-069).
- **Before launch (TUI-86):** two manual steps, and nothing does either automatically. Remove or narrow Access in the Cloudflare dashboard: the web app is served by the same Worker, so customers are blocked while it covers all traffic (D-069). Set `ENABLE_DOCS` back to `false` under `env.production` and redeploy (D-068).
- **Clerk:** the owner set `CLERK_SECRET_KEY` on the Worker on 2026-10-12. Checked before Access was on: a call without a token returned 401. A signed-in call hasn't been checked (D-068).
- **Not ready yet:** `CLERK_AUTHORIZED_PARTIES` is empty until the web app has an origin, so the token's `azp` claim isn't checked. The CI pipeline isn't built: it needs the owner's go-ahead (D-065, D-066).

---

## 5. Key technical conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1`; org data under `/orgs/{orgId}`; current user under `/me`; public forms under `/public/{orgSlug}`. Orgs are addressed by path, not subdomain. Public web pages use the slug too, e.g. `/f/{orgSlug}/…` for enquiry and enrolment forms (later the parent portal link); a vanity subdomain may come later as a redirect (D-020). |
| Format | JSON, camelCase |
| IDs | Prefixed, sortable (ULID-style): `org_`, `brn_`, `rm_`, `grd_` (grade level), `sbj_` (subject), `acy_` (academic year), `trm_` (term), `hol_` (holiday), `txr_` (tax rate), `stu_`, `fam_`, `gdn_` (guardian), `sgr_` (a student's grade for one academic year), `crs_`, `cls_`, `csl_` (a class's weekly slot), `ses_`, `enr_`, `att_` (a student's mark at a session), `prr_` (price rule), `inv_`, `pay_`, `job_` … |
| Lists | Cursor paging: `?limit=50&cursor=…` → `{ data, nextCursor }`. Filters as query params, `q` for search (prefix match on normalised names, exact email/phone, D-026). A short, capped list may return everything with `nextCursor: null` (grade levels, D-035). Setup lists, courses, classes, enrolments and price rules come oldest first by id, except grade levels (grade order) and academic years, terms and holidays (start date, then id, D-040). Sessions come by date, start time, then id, and `GET /sessions` needs `from` and `to` (D-050). Families come in name order, and students by last name, then first name, then id. The order uses normalised names, so case and accents don't change it, and the cursor holds every sort key (D-056). A session's attendance isn't paged: the whole roster comes back in student name order (D-072). A filter by another record's id (`?academicYearId`, `?branchId`, `?subjectId`, `?gradeLevelId`, `?termId`, `?courseId`, `?roomId`, `?teacherId`, `?classId`, `?familyId`, `?studentId`) is 404 when the org doesn't have that id (D-043, D-050, D-057, D-063, D-085). |
| CRUD | `POST` returns 201 and the resource. `PATCH` is a partial update; one that sends only `updatedAt` changes nothing and returns the record (D-034). `DELETE` is a soft delete (`deleted_at`) and returns 204. |
| Unique names | Setup names (branches, grade levels, subjects, academic years, tax rates; rooms within a branch; terms within an academic year) are unique per org, ignoring case and deleted rows. Holiday names can repeat. A clash is 409 `conflict` with `fields.name` (D-034, D-040). A course has no name: it is unique on subject + grade level + curriculum + teaching medium, ignoring case and deleted rows. A clash is 409 `conflict` with `fields._`, the key for an error that belongs to no single field (D-041, D-043). A class name is unique among its course's classes in the same term and branch; a clash is 409 with `fields.name` (D-049). Family names can repeat (D-057). A price rule has no name either: one target (a class, a course or the whole org) can't have two rules that could price the same class, and a clash is 409 with `fields._` (D-081). |
| Actions | Verb sub-path with `POST`, e.g. `POST /terms/{id}/generate-invoices` |
| Long jobs | Return 202 `{ jobId }`, then poll `GET /jobs/{id}` until `succeeded` or `failed`. Starting a job writes a `job.started` audit row. A failed try is retried up to 3 times, so job handlers must be idempotent (D-017). |
| Edit conflicts | Client sends `updatedAt`. Stale data returns 409. Two routes take no `updatedAt`: saving a class's schedule, where the later save wins (D-050), and marking attendance, where the last mark for a student wins (D-071). |
| Idempotency | `Idempotency-Key` header on invoices, payments and bulk actions. Marking attendance takes none: sending the same marks again changes nothing (D-071). |
| Errors | `{ "error": { "code": "validation_failed", "message": "...", "fields": { ... } } }`. Statuses: 400/401/403/404/409/422/429. `code` (and field error codes) is the stable key the client translates; `message` is English, for developers (D-015). |
| Language | The API is locale-neutral: no `Accept-Language`, no translated responses. It returns raw values (money in minor units + ISO 4217 code, UTC timestamps, `YYYY-MM-DD` dates) and clients format them with shared helpers in `packages/shared`, which the API also uses for emails, PDFs and crons. User-facing strings go through `t('key')` with a single `en` catalog: the web app's, and one for server-rendered text (system emails, PDFs). Org-authored content is never translated (D-015). |
| Money | Integer minor units + currency: `{ "amount": 2490, "currency": "NZD" }`. Decimal places per currency come from a fixed ISO 4217 table (JPY 0, KWD 3), not runtime `Intl` data. |
| Tax rates | `rateBps`: an integer in basis points, 0–10000 (1500 = 15%, 1250 = 12.5%, 0 = zero-rated), an integer like money's minor units. Only 2 decimals of a percent are supported (8.875% can't be entered). Non-integers, strings, negatives and values over 10000 are 400 (D-039). At most one rate per org is the default (`isDefault`): it applies to every price that doesn't name its own rate. It is set explicitly, and no default means no tax on those prices (D-080, D-084). |
| Dates/times | Sessions store a local date and local start and end times (`"date": "2026-10-14", "startTime": "16:00", "endTime": "17:00"`), read in the org's timezone, so lessons stay at 4 pm across daylight-saving changes. The API also returns `startsAt` and `endsAt` in UTC, worked out when read; no UTC time is stored (D-047). A local time skipped when clocks go forward moves forward by the gap; one that happens twice resolves to the earlier instant (D-016). Weekdays are ISO: 1 = Monday … 7 = Sunday. Event timestamps are ISO UTC. Date ranges (`startDate`, `endDate`) include both ends; one day has the same start and end. An end before the start is 400 on `endDate`, including a PATCH whose new end falls before the stored start (D-040). |
| Versioning | Only additive changes within v1. Breaking changes go to v2. |
| Rate limits | Cloudflare rate-limit rules per user and per org; returns 429 with `Retry-After` |
| Common columns | `id`, `org_id`, `created_at`, `updated_at`, `deleted_at` |

---

## 6. Roles and permissions

Roles are stored in the `memberships` table, not in Clerk. "Branch" means only the branches listed on that membership.

| Area | Owner | Branch manager | Front desk | Teacher | Parent | Accountant |
|---|---|---|---|---|---|---|
| Org settings, plan | Full | — | — | — | — | Read |
| Branches, rooms, grade levels, subjects, academic years, terms, holidays (D-033, D-040) | Full | Read | Read | Read | Read | Read |
| Tax rates (D-039) | Full | Read | Read | Read | Read | Read |
| Staff and roles | Full | Branch | — | — | — | — |
| Families and students (D-051, D-053, D-060) | Full | Branch | Branch | Own classes, read | Own family, read | — |
| Courses (D-041, D-042) | Full | Full, org-wide | Full, org-wide | Read | Read | Read |
| Classes and timetable (D-048, D-060) | Full | Branch | Branch | Own classes, read | Own children, read | — |
| Enrolments (D-058, D-059) | Full | Branch | Branch | Own classes, read | Own children, read | — |
| Attendance and notes (D-073) | Full | Branch | Branch | Own classes | Own children, read; report absence | — |
| Fees and payments (price rules: D-083) | Full | Branch | Branch | — | Own invoices, read | Read + export |
| Messages | Full | Branch | Branch | Own classes | Own family | — |
| Reports | Full | Branch | Limited | Own classes | — | Money only |
| Audit log (D-030) | Full | — | — | — | — | — |

Setup data (branches, rooms, grade levels, subjects, the calendar and tax rates) is read org-wide, so a branch manager sees every branch, not only theirs (D-033).

Courses have no branch. A branch manager or front desk member limited to some branches still adds, changes and deletes courses for the whole org (D-041). Every role reads all courses, default prices included. That read rule is an assumption from the build, for the owner to confirm (D-042).

Classes and sessions (D-048, D-060):

- A branch manager or front desk member reads and writes only the classes in their membership's branches, and those classes' sessions. No branch list means every branch.
- A teacher reads only the classes they teach, and those classes' sessions.
- A class or session outside the caller's reach is 404, as if it didn't exist. Adding a class in a branch outside the member's branches is 403.
- A parent reads only the classes one of their children holds an active enrolment in, and all of those classes' sessions (D-060). Their children are the students of the families they are a signed-in guardian of.
- An accountant gets 403.

Families, guardians and students (D-051, D-053, D-060):

- A family has a home branch, and its guardians and students go with it. A branch manager or front desk member reads and writes only the families whose home branch is one of their membership's branches. No branch list means every branch.
- A child in a class at another branch shows on that class's roster by name: each enrolment and each attendance record carries the student's name (D-061, D-072). Only the home branch, the owner and staff with no branch limit change the family record.
- A parent reads only the families where one of the guardians is linked to their membership (the guardian's `membershipId`), and changes nothing.
- A teacher reads only the students who hold an active enrolment in a class they teach, and those students' families with all their guardians. A family's other children are left out of its `students` list and are 404 (D-060).
- An accountant gets 403.
- A family, guardian or student outside the caller's reach is 404, as if it didn't exist. Adding a family to a branch outside the member's branches, or moving one there, is 403.

Enrolments (D-058, D-059):

- The enrolment routes use the class permissions (`classes:read`, `classes:write`). There is no separate enrolment permission.
- To enrol a student, the caller must reach both the student and the class. A branch manager or front desk member limited to some branches can't enrol a student whose family's home branch is another one, or enrol into another branch's class: either id is 404. Cross-branch enrolments go through the owner or staff with no branch limit (D-058).
- A branch-limited member reads the enrolments in their branches' classes, and those of their branches' students wherever the class is. Either is enough.
- A teacher reads only the enrolments in the classes they teach, and a parent only their own children's. Neither can enrol (403). An accountant gets 403.
- Only an active enrolment gives a teacher or a parent their reach. Its dates don't matter: one that starts later already counts (D-060).

Attendance (D-073, D-074):

- The attendance routes use `attendance:read` and `attendance:write`. A session's attendance is reached through the session, with the class reach above. A session outside the caller's reach is 404.
- The owner reads and marks every session. A branch manager or front desk member reads and marks their branches' sessions.
- A teacher reads and marks the sessions of the classes they teach. It is the only thing a teacher writes so far: classes and sessions stay read-only for them.
- A parent reads only their own children's records on a session, never the rest of the roster, and marks nothing (403).
- An accountant gets 403.
- Branch-limited staff mark a child from another home branch by name, and still can't open that student or family. That is an assumption from the build, for the owner to confirm (D-074, §11).

Price rules (D-083):

- The price-rule routes use `billing:read` and `billing:write`. The owner, branch managers and front desk read and write. An accountant reads only (403 on writes). A teacher gets 403.
- A parent gets 403 too. Their `billing:read` is for their own invoices, and price rules belong to no family.
- An org-wide rule and a course's rule have no branch. A branch manager or front desk member limited to some branches still adds, changes and deletes them for the whole org, as with courses (D-041).
- A class's rule goes with its class's branch. Staff limited to some branches don't see other branches' class rules, and such a rule or class is 404 for them, as for the class itself (D-048).
- So front desk and branch managers can change prices for the whole org. That is an assumption from the build, for the owner to confirm (§11).

Background jobs are visible only to the person who started them and the owner; others get 404 (D-018).

Parents are Clerk users, signing in passwordless by email code or magic link. Accepting an invite links them to a `parent` membership (D-021). A guardian row points at that membership, which is what "own family" means. Nothing sets that link yet: invites will (TUI-42, TUI-72) (D-053).

Student logins come later (v1.1+). The super-admin console sits outside org routes, and every access is logged, including impersonation.

---

## 7. Data model (core tables)

All tables except `users` include `org_id`, `created_at`, `updated_at` and `deleted_at`. Indexes lead with `org_id`.

| Area | Tables | Key columns |
|---|---|---|
| Org and setup | `orgs`, `branches`, `rooms`, `tax_rates` | currency, timezone, locale (formatting region, `en-*` only, D-015), date format (overrides the locale's default), plan, status, slug, single-tutor mode (one branch only, D-032); branch name, address (every org starts with "Main", D-031); room → branch, capacity; tax rate name, rate in basis points (`rate_bps`, 1500 = 15%), inclusive flag (D-039), default flag (at most one default per org, D-080, D-084) |
| People and access | `users`, `memberships`, `invitations` | `clerk_user_id`; role, branch ids, status |
| Calendar | `academic_years`, `terms`, `holidays` | name, start/end dates; academic years never overlap; term → academic year, inside it, no overlapping terms (D-037); holiday date range, optional branch (null = org-wide) (D-038) |
| Curriculum | `grade_levels`, `subjects`, `courses` | grade name, sort order (from 1, gaps allowed, at most 100 grades per org, D-035); subject name; **course = subject × grade**, with no name of its own; optional curriculum and teaching medium (free text), default price (minor units + currency, in the org's currency; for one billing period of a class: a term, or a month with no term, D-077), usual lesson length in minutes; unique on subject + grade + curriculum + medium (D-041, D-043) |
| Classes | `classes`, `class_schedules`, `sessions` | class → course (with the course's grade level copied on), term (optional: no term = open-ended from its start date, billed monthly, D-036), branch; name (unique per course, term and branch); optional room, teacher (a membership), capacity and start/end dates (D-049); one row per weekly slot: ISO weekday, local start and end time (D-050); session → class, with its own room and teacher (copied from the class when generated), local date, start and end time, status (`scheduled`, `cancelled`), no UTC columns (D-047) |
| Families | `families`, `guardians`, `students`, `student_grades` | family name, home branch (required, D-051), address, billing contact (one of its guardians: the first added, until another is chosen, D-054); guardian → family, first and last name, relationship, email, phone, preferred channel (`email`, `sms` or `whatsapp`; stored only), language (stored only; unused in the MVP, D-015), emergency-contact flag, the `parent` membership they sign in with (D-053); student → family, first and last name, date of birth, notes; **grade per academic year**: one `student_grades` row per student and year (D-055); normalised (lower-case, accent-stripped) name columns on all three, for name-order lists now and for search and duplicate warnings later (D-026, D-056); no consent columns yet: privacy controls (TUI-79) define them (D-052) |
| Enrolment | `enrolments`, `enrolment_requests` | enrolment → student, class; start date and optional end date (null = until the class ends), both inside the class's dates; optional price override (minor units + currency, in the org's currency; replaces the amount of the class's usual price and keeps its basis, D-077); status (`active`, `withdrawn`); at most one active enrolment per student and class (D-062) |
| Attendance | `attendance`, `absence_notices`, `makeup_policies`, `makeup_credits`, `makeup_bookings` | one `attendance` row per student marked at a session: session, student, status (`present`, `absent`, `late`, `excused`); at most one per session and student; no row means not marked, and clearing a mark soft-deletes its row (D-075); credit source, expiry, used-by |
| Learning | `lesson_notes` | session, per-student note, homework text |
| Money | `price_rules`, `discount_rules`, `invoices`, `invoice_lines`, `payments`, `payment_allocations` | minor units; price rule → one class, one course or neither (org-wide), with a class's branch copied on (D-083); basis (`per_term`, `per_month`, `per_lesson`, `pack`), price (minor units + currency), lessons per pack, free-trial lessons, optional tax rate (null = the org's default); per target, at most one rule that fits classes in a term and one that fits classes with no term (D-081, D-085); invoice status (draft, issued, paid, part-paid, void); payment method and reference; unique bank reference per family |
| Messages | `messages`, `message_recipients`, `message_templates`, `notification_settings` | channel (email for MVP), audience, delivery status |
| Platform | `files`, `imports`, `jobs`, `audit_log`, `exports`, `org_subscriptions` | R2 key; import mapping; job type, status, progress, attempts, last error, started-by user (D-017, D-018); actor, action, before/after; Paddle subscription id |

### Grade and subject model
- Each org defines its own ordered **grade levels** (NZ Year 1–13, US Grade K–12, Sri Lanka Grade 1–13 / O/L / A/L) and its **subjects**.
- **Course = subject × grade** (e.g. "Year 10 Maths"). **Class** = one group of a course at a set time with a teacher (e.g. "Year 10 Maths – Group A – Tue 4pm").
- A course has no name of its own. Clients build it from the grade level and subject, plus the curriculum and teaching medium when set, so "Year 10 Maths (Cambridge)" and "Year 10 Maths (NCEA)" can both exist (D-041).
- A student takes several subjects as several enrolments.
- `student_grades` stores the grade per academic year. A student's current grade is the one for the current academic year: the year today falls in, else the one that ended most recently, else the first one to start, worked out in the org's timezone (D-055). **Year-end promotion** moves everyone up a grade, with exceptions.
- **Per-subject pricing and bundles:** each enrolment is priced on its own, from a price rule for its class, its course (a subject at a grade) or the whole org, charged per term, per month, per lesson or per pack (D-081, D-082). Bundles (a price by number of subjects: 1, 2, 3+; grade bundles like "Year 10 core") are built with the discounts in TUI-58, as an amount off or a fixed bundle price, so a bundle and a multi-class discount can't both apply (D-079).
- **Grade timetable view** (v1.1, D-022): a school-style weekly grid per grade that warns when one grade's subjects overlap.

---

## 8. MVP feature scope

### In the MVP
- **Org and setup:** profile and branding, single-tutor mode, branches and rooms, terms and holidays (or rolling monthly: terms are optional per class, D-036), locale settings (formatting region; UI in English, D-015), tax settings, academic years, grade levels and subjects.
- **People:** family records, each with a home branch (D-051); student profiles; emergency contacts, kept as guardians with an emergency-contact flag (D-054); consents, which come with privacy controls (TUI-79; no consent fields on records until then, D-052); staff profiles; prefix search with duplicate warnings (D-026).
- **Enquiry and enrolment:** enquiry form (embeddable/link), online enrolment form with staff approval, enrol/transfer/withdraw with pro-rata, year-end promotion.
- **Courses and pricing:** courses (curriculum and teaching medium as optional plain-text labels, D-043), class types, capacity, pricing models (per term, per lesson, monthly, packs, free trial) as price rules for a class, a course or the whole org (D-078, D-081), discounts (sibling, multi-class, early-bird, scholarship, manual), per-subject pricing, and bundles, which are built with the discounts (TUI-58, D-079).
- **Timetable:** recurring schedules with holidays skipped, including holidays added later (D-046); sessions generated to the end of the term, or 13 weeks ahead for a class with no term (D-044); calendar views (day/week/month by branch, room, teacher, student), clash detection, one-off changes with family notices.
- **Attendance and make-ups:** one-tap attendance on phone, parent absence notices, make-up policy, automatic make-up credits, staff make-up booking.
- **Learning:** lesson notes (typed).
- **Fees:** automatic term/monthly invoices, pro-rata, tax on invoices, recording payments (partial, receipts), unique bank transfer references, overdue reminders **by email**.
- **Communication:** announcements (all, branch, grade, subject, class, teacher's students, custom list), email and portal channels, automatic messages, message templates.
- **Parent portal (PWA):** passwordless sign-in through Clerk (email code or link, D-021), timetable and changes, invoices and balance, reporting absences.
- **Teacher:** a today view, plus attendance and notes on phone.
- **Reports:** home dashboard, money reports (invoiced vs received, aged debt, tax collected).
- **Data and platform:** org data isolation, login security (passwordless parents, 2FA for staff), audit log, mobile-first PWA, full data export, privacy controls (consents, retention, delete a family).
- **SaaS layer:** sign-up and trial, onboarding wizard, plans and limits, Paddle subscription billing, super-admin console.
- **Import:** spreadsheet import with **manual** column mapping (kept in the MVP: centres won't retype 100 students, D-022). AI mapping is part of the AI add-on.

### Not in the MVP (v1.1 / Later / add-ons)
- **v1.1:** term roll-over, student timeline, grade timetable view and drag-and-drop timetable editing (moved from the MVP, D-022), roles and permissions UI (custom permission sets), custom fields, school-type templates (music, language/cultural, dance; academic tuition comes first, D-028), UI languages (English only in the MVP, D-015), one login across many orgs, document templates, curriculum/medium tags (managed tags and filtering; the MVP has plain-text labels, D-043), grade-range classes, split billing, sensitive notes, staff availability and documents, lead pipeline, trial lessons, waitlists, placement tests, price history, syllabus, substitutes, calendar feeds, 1:1 booking slots, centre-cancelled bulk credits, absence follow-up, homework, assessments, progress reports, combined report card, report cards (PDF), credits and refunds, bank statement import, family statements, instalments, accounting export, shared inbox, teacher–parent messaging, parent make-up booking, parent progress view, parent profile updates, teacher hours, pay rules and pay export, events and RSVPs, enrolment/class-fill/attendance/lead reports, data region choice, offline attendance, calendar and video integrations, usage-based add-ons, help centre.
- **Later:** public class listing, prerequisites, timetable builder, check-in kiosk, external exam tracking, skill maps, practice logs, newsletters, student login, teacher invoices, parent–teacher meetings, performer line-ups, volunteer rosters, galleries, resource library, custom reports, public API and webhooks, native mobile apps, referral programme, large-class attendance (custom only).
- **Paid add-ons:** WhatsApp, SMS, all AI features (report comment drafts, voice notes, translation, make-up matching, "ask your data", at-risk alerts, timetable suggestions, bank-match assist, AI import mapping).
- **Out of scope for now:** online payments from parents.

---

## 9. MVP API endpoint list

Paths are relative to `/api/v1/orgs/{orgId}` unless they start with `/api/v1`. About 150 endpoints in total, of which about 35 carry real logic.

### Account and onboarding
- `GET /api/v1/me`
- `POST /api/v1/orgs`: also creates the org's "Main" branch (D-031)
- `GET /`
- `PATCH /`: turning on single-tutor mode is refused (422) while the org has more than one branch (D-032)

### Setup
Branches, rooms, grade levels, subjects, the calendar and tax rates: every role reads, only the owner writes (D-033, D-039, D-040).
- `GET|POST /branches` · `PATCH|DELETE /branches/{branchId}`: `POST` is refused (422) in single-tutor mode (D-032). `DELETE` is refused (422) for the org's last branch, a branch with rooms, classes or its own holidays, a family's home branch, or one a membership's `branch_ids` lists (D-034, D-038, D-050, D-057).
- `GET|POST /branches/{branchId}/rooms` · `PATCH|DELETE /rooms/{roomId}`: a room can't move to another branch (D-034). `DELETE` is refused (422) while a class uses the room (D-050)
- `GET|POST /tax-rates` · `PATCH|DELETE /tax-rates/{taxRateId}`: `rateBps` is an integer in basis points (1500 = 15%); no tax rates means no tax (D-039). `isDefault: true` on `POST` or `PATCH` makes the rate the org's default and takes the flag off the rate that had it; it is false unless sent, and `false` on `PATCH` leaves the org with no default. No default means no tax on prices that don't name a rate (D-080, D-084). `DELETE` is refused (422) while a price rule names the rate (D-085)
- `GET|POST /academic-years` · `PATCH /academic-years/{academicYearId}`: no `DELETE`. Years can't overlap; a date change that would overlap another year or leave a term outside is refused (422) (D-037)
- `GET|POST /terms` (`GET` filter `?academicYearId`) · `PATCH|DELETE /terms/{termId}`: a term sits inside its academic year and can't overlap another term (422); `PATCH` can't move it to another year (D-037). `DELETE` is refused (422) while a class uses the term (D-050)
- `GET|POST /holidays` (`GET` filters `?from`, `?to`, `?branchId`) · `DELETE /holidays/{holidayId}`: org-wide, or one branch with `branchId`. `?branchId=X` returns X's own holidays plus org-wide ones; `?from`/`?to` keep holidays that touch the range. No `PATCH`: delete and re-add (D-038). `POST` also removes the sessions already generated on the closed dates that are still scheduled and haven't started; `DELETE` doesn't put them back (D-046)
- `GET|POST /grade-levels` · `PATCH|DELETE /grade-levels/{gradeLevelId}` · `PUT /grade-levels/order`: `GET` returns the whole list in grade order, not paged; `PUT` must list every grade exactly once (D-035). `DELETE` is refused (422) while a course or a student grade record uses the grade level (D-043, D-057)
- `GET|POST /subjects` · `PATCH|DELETE /subjects/{subjectId}`: `DELETE` is refused (422) while a course uses the subject (D-043)

### Staff
- `GET /staff`
- `POST /staff/invitations`
- `POST /api/v1/invitations/{token}/accept`
- `PATCH /staff/{membershipId}`
- `DELETE /staff/{membershipId}`

### Families and students
The owner reaches every family; branch managers and front desk the families whose home branch is one of theirs (read and write); a parent the families they are a signed-in guardian of (read only); a teacher the students who hold an active enrolment in a class they teach, with those students' families and guardians but not their siblings (read only). An accountant gets 403. Guardians and students are reached through their family. Anything outside the caller's reach is 404 (D-051, D-053, D-060).

- `GET|POST /families` (`GET` filter `?branchId`) · `GET|PATCH|DELETE /families/{familyId}`: in name order. Every response carries the family's `guardians` and `students`. `branchId`, the home branch, is required, and `PATCH` can move the family to another branch; branch-limited staff adding or moving a family to a branch outside theirs get 403. `billingGuardianId` must be one of the family's guardians (422) and can't be set to null. `DELETE` is refused (422) while the family has students; otherwise it also deletes the guardians (D-051, D-054, D-057)
- `POST /families/{familyId}/guardians` · `PATCH|DELETE /guardians/{guardianId}`: any contact person, with an `emergencyContact` flag (default true). The family's first guardian becomes its billing contact. `email` and `phone` are optional; `preferredChannel` is `email` (default), `sms` or `whatsapp`; `membershipId` is read-only. `PATCH` can't move a guardian to another family. `DELETE` is refused (422) for the billing contact (D-053, D-054)
- `GET|POST /students` (`GET` filters `?familyId`, `?branchId`, `?gradeLevelId` with optional `?academicYearId`) · `GET|PATCH|DELETE /students/{studentId}`: by last name, then first name. `gradeLevelId`, with an optional `academicYearId`, sets the student's grade for that academic year, or for the current one; `PATCH` with `gradeLevelId: null` removes it; with no academic year in the org it is 422. Each student carries `gradeLevelId` (the current year's grade), `grades` (every year on record) and `branchId` (the family's home branch). `dateOfBirth` can't be in the future (400). `PATCH` can't move a student to another family. `DELETE` is refused (422) while the student has enrolments; otherwise it also deletes the student's grade records (D-055, D-057, D-063)
- `GET /students/{id}/timeline` (v1.1, D-022)
- `POST /students/promote` (job)
- `GET /search?q=` (prefix search, D-026)

### Spreadsheet import
- `POST /imports`
- `GET /imports/{id}`
- `PATCH /imports/{id}` (column mapping)
- `POST /imports/{id}/commit` (job)

### Courses, classes and timetable
Courses: every role reads (an assumption to confirm, D-042); the owner, branch managers and front desk write, for the whole org (D-041).
- `GET|POST /courses` (`GET` filters `?subjectId`, `?gradeLevelId`) · `PATCH|DELETE /courses/{courseId}`: subject + grade level + curriculum + teaching medium must be unique (409). `PATCH` can't change the subject or grade level. `defaultPrice` must be in the org's currency (400) and is for one billing period of a class: a term, or a month for a class with no term (D-077); `durationMinutes` is the usual lesson length, 5 to 600. A `subjectId` or `gradeLevelId` the org doesn't have is 404, in a filter too (D-041, D-043). `DELETE` is refused (422) while a class uses the course or a price rule prices it (D-050, D-085)

Classes and sessions: the owner reaches all of them, branch managers and front desk their branches' (read and write), a teacher the classes they teach and a parent the classes their children hold an active enrolment in (both read only). Anything outside the caller's reach is 404 (D-048, D-060).

- `GET|POST /classes` (`GET` filters `?branchId`, `?termId`, `?courseId`, `?gradeLevelId`, `?teacherId`) · `GET|PATCH|DELETE /classes/{classId}`: each class carries its weekly `schedule`. `termId` is optional; a class without one needs a `startDate` (D-036). In a term, the class's own dates must fall inside it (422). The name is unique among the course's classes in the same term and branch (409). `teacherId` is a membership id; the room must be in the class's branch (422). `PATCH` can't change the course, term or branch; a new room or teacher also goes onto upcoming sessions, and new dates add and remove them. `DELETE` is refused (422) while the class has enrolments or a price rule of its own; otherwise it also deletes the schedule and all the class's sessions (D-049, D-063, D-085)
- `PUT /classes/{classId}/schedule`: body `{ slots: [{ weekday, startTime, endTime? }] }`, the whole weekly schedule, at most 14 slots; `endTime` defaults to the course's lesson length; slots on one weekday can't overlap (400). Brings upcoming sessions in line: ones that match are kept, others removed, missing ones added, holidays skipped. Sessions that have started never change. Generates to the end of the term, or 13 weeks ahead with no term. Returns `{ class, sessions: { added, removed, kept, through } }` and writes one audit row (D-044, D-045, D-047, D-050)
- `GET /sessions` (`from` and `to` required, both included; filters `?branchId`, `?roomId`, `?teacherId`, `?gradeLevelId`, `?classId`, `?studentId`): by date, start time, then id. Each session has the local `date`, `startTime` and `endTime`, plus `startsAt` and `endsAt` in UTC (D-047, D-050). `?studentId` gives one student's timetable: the sessions of the classes they hold an active enrolment in, only on the dates each enrolment covers, and only the classes the caller reaches. A student the caller can't reach is 404 (D-063)
- `GET /sessions/{sessionId}`
- `PATCH /sessions/{id}` (move or cancel; notifies families)
- `GET /timetable/clashes`

### Enrolment
The enrolment routes use the class permissions. The owner, branch managers and front desk read and write; a teacher reads the enrolments in the classes they teach and a parent their own children's; an accountant gets 403. To enrol a student the caller must reach both the student and the class, so branch-limited staff can't enrol across branches: a student or class out of reach is 404 (D-058, D-059).

- `GET|POST /enrolments` (`GET` filters `?studentId`, `?classId`): oldest first; `?classId` gives a class's roster. Each enrolment carries the student's name and the class's name, course and branch (D-061). `startDate` defaults to today, or to the class's first day when that is later; `endDate` is optional (null = until the class ends). Both must fall inside the class's dates (422). `priceOverride` is Money or null and must be in the org's currency (400); it replaces the amount of the class's usual price and keeps its basis (D-077). A student holds one active enrolment in a class (409), and a class with a `capacity` refuses a new one once its places are taken (422). The student's grade isn't checked against the class's. No `GET /enrolments/{id}` and no `DELETE` (D-062, D-063)
- `PATCH /enrolments/{id}` (transfer or withdraw, pro-rata)
- `POST /api/v1/public/{orgSlug}/enquiries`
- `POST /api/v1/public/{orgSlug}/enrolment-requests`
- `GET /enrolment-requests`
- `POST /enrolment-requests/{id}/approve`
- `POST /enrolment-requests/{id}/reject`

### Attendance and make-ups
A session's attendance is reached through the session: the owner every session, branch managers and front desk their branches' and a teacher the classes they teach (all read and mark). A parent reads their own children's records only, and an accountant gets 403. A session outside the caller's reach is 404 (D-073).

- `GET /sessions/{sessionId}/attendance`: the session's roster, `{ sessionId, records: [{ studentId, studentFirstName, studentLastName, status, markedAt }] }`, not paged, by last name, then first name. The roster is the students whose active enrolment in the class covers the session's date, plus anyone already marked. `status` is `present`, `absent`, `late` or `excused`, or null until the student is marked; `markedAt` is when it was last set. Works for any session, a future or cancelled one too (D-070, D-072)
- `PUT /sessions/{sessionId}/attendance`: body `{ records: [{ studentId, status }] }`, 1 to 1000 records, each student once (400). It merges: each student listed takes the status sent, `status: null` clears the mark, and anyone left out keeps theirs. So one tap sends one student and "mark all" sends the class. Refused (422) for a session dated after today in the org's timezone, for a `cancelled` session, and when a `studentId` isn't on the roster; then nobody is marked. Returns the roster as `GET` does and writes one `attendance.marked` audit row listing the students whose status changed; marks already in place write nothing (D-070, D-071, D-072, D-075)
- `GET|POST /absence-notices`
- `GET|PUT /makeup-policy`
- `GET /makeup-credits`
- `POST /makeup-bookings` · `DELETE /makeup-bookings/{id}`

### Lesson notes
- `GET /sessions/{id}/notes`
- `PUT /sessions/{id}/notes`

### Fees and payments
Price rules: the owner, branch managers and front desk read and write; an accountant reads; a teacher or a parent gets 403. Org-wide and course rules are written for the whole org, by branch-limited staff too. A class's rule goes with its class's branch, and one outside the caller's branches is 404. Who writes them is an assumption to confirm (D-083).

Which price an enrolment gets, most specific first: its class's own rule, its course's rule, the course's `defaultPrice` (per term, or per month for a class with no term), then the org-wide rule. A rule on a basis that doesn't fit the class is skipped. An enrolment's `priceOverride` replaces the amount and keeps the basis, pack size, free trial and tax rate. Tax is the rule's rate, else the org's default rate, else none. With none of these the enrolment has no price. No endpoint returns the resolved price: invoice generation (TUI-37) reads it and turns it into amounts (D-077, D-082).

- `GET|POST /price-rules` (`GET` filters `?courseId`, `?classId`) · `PATCH|DELETE /price-rules/{priceRuleId}`: oldest first; a filter gives that course's or class's own rules. A rule prices one class (`classId`), one course's classes (`courseId`) or, with neither, every class in the org; both together is 400. `basis` is `per_term`, `per_month`, `per_lesson` or `pack`. `price` is Money in the org's currency (400); 0 is free. `packLessons` (2 to 200) is required for a pack and refused otherwise (400): that many lessons for one price, invoiced up front. `freeTrialLessons` (0 to 20, default 0) is the first lessons of an enrolment that aren't charged. `taxRateId` is optional; null means the org's default rate. A `courseId`, `classId` or `taxRateId` the org doesn't have is 404. A class's rule on a basis the class isn't billed on (`per_month` in a term, `per_term` with no term) is 422. One target can't have two rules that could price the same class (409): `per_term` and `per_month` can sit side by side, and `per_lesson` or `pack` excludes any other. `PATCH` changes only `price`, `packLessons`, `freeTrialLessons` and `taxRateId`, never the target or the basis. No `GET /price-rules/{priceRuleId}` (D-078, D-081, D-085)
- `GET|POST /discount-rules` · `PATCH|DELETE /discount-rules/{id}`: bundles are built here too, as an amount off or a fixed bundle price (D-079)
- `POST /terms/{id}/generate-invoices` (job). Classes with no term are billed monthly, so TUI-37 also needs a month-based action; its path isn't decided yet (D-036)
- `GET /invoices` · `GET|PATCH /invoices/{id}`
- `POST /invoices/{id}/issue`
- `POST /invoices/{id}/void`
- `GET /invoices/{id}/pdf` (Browser Rendering, D-025)
- `GET|POST /payments` · `DELETE /payments/{id}`
- `GET /payments/{id}/receipt` (PDF, D-025)

### Messages
- `GET|POST /messages` · `GET /messages/{id}`
- `GET|POST /message-templates` · `PATCH|DELETE /message-templates/{id}`
- `GET|PUT /notification-settings` (automatic messages and reminders on or off)

### Parent portal
Parents sign in through Clerk like staff and hold a `parent` membership (D-021).
- `GET /portal/children`
- `GET /portal/sessions`
- `GET /portal/invoices`
- `GET /portal/invoices/{id}/pdf`
- `POST /portal/absence-notices`
- `GET /portal/makeup-credits`

### Reports
- `GET /reports/dashboard`
- `GET /reports/money`

### Platform
- `GET /jobs/{id}`: only the person who started the job and the owner can see it; anyone else gets 404 (D-018)
- `GET /audit-log`: owner only; every other role gets 403 (D-030)
- `POST /exports` · `GET /exports/{id}`
- `POST /files/upload-url` · `GET /files/{id}`
- `GET /billing/subscription`
- `POST /billing/checkout`
- `POST /billing/portal`

### Webhooks
While production is behind Cloudflare Access, these paths need an Access bypass, or the callbacks never reach the Worker (§4, D-069).
- `POST /api/v1/webhooks/clerk`
- `POST /api/v1/webhooks/paddle`
- `POST /api/v1/webhooks/resend`

### Super-admin
- `GET /api/v1/admin/orgs`
- `GET|PATCH /api/v1/admin/orgs/{id}`
- `POST /api/v1/admin/orgs/{id}/impersonate` (logged)

---

## 10. Scheduled jobs and queues

| Name | Trigger | Does |
|---|---|---|
| Hourly cron | Every hour; acts on orgs whose local time matches | Overdue invoice reminders (email), make-up credit expiry |
| Daily cron | Daily | Extends generated sessions ahead: keeps classes with no term generated 13 weeks ahead (D-044); cleans expired files and links; nightly per-org export to R2 (backup + owner export) |
| `email` queue | Any email | Render template → Resend → retry with backoff → update delivery status |
| `jobs` queue | Bulk actions | Term invoices, promotion, imports, PDF batches (Browser Rendering, D-025); roll-over in v1.1 (D-022); progress in `jobs`. Handlers run as the user who started the job. A failed try goes back to `queued` and is retried up to 3 times; the job is `failed` only when the last try fails, and `succeeded`/`failed` are final, so a redelivered message is ignored. Each try reruns the whole handler and a message can arrive twice, so **handlers must be idempotent**. No dead-letter queue yet: final failures are logged (D-017). |
| Webhooks | Clerk / Paddle / Resend | Sync users; update plan, limits and status; update email delivery status. All webhooks verify signatures and are idempotent. |

---

## 11. Open questions

**Product and business**
- [x] Is the ~65-feature MVP too big for the first launch? Consider cutting to a thinner first release. → Move term roll-over, student timeline, grade timetable view and drag-and-drop timetable editing to v1.1; keep spreadsheet import and the rest (D-022)
- [x] Annual billing discount? Which currency is shown in each country? → Annual at launch, two months free (Solo US$99/yr, Small US$249/yr); USD base with hand-set NZD, AUD and GBP prices, Paddle conversion elsewhere (D-027)
- [ ] Add-on pricing: monthly packs or pay-as-you-go at cost plus margin (WhatsApp priced by region)?
- [x] Which school-type template gets polished first? → Academic tuition (D-028)
- [ ] Accounting export format for v1.1: Xero, QuickBooks or CSV?
- [x] Product name and domain. → EduStrux, edustrux.com; domain registration by the owner pending (D-023)
- [x] Confirm the side-business and IP clauses in the employment agreement before building. → Confirmed by the owner (D-019)
- [ ] Who reads courses? Built so every role reads them, so teachers, parents and accountants see default prices. This is an assumption from the build, not an owner decision (D-042): confirm it or restrict reads.
- [ ] Who writes price rules? Built so branch managers and front desk add, change and delete them like the owner, and so org-wide and course rules ignore a member's branch limit: they change prices for the whole org. They can already set a course's default price (D-041) and an enrolment's override (D-062). This is an assumption from the build, not an owner decision (D-083): confirm it or restrict writes.
- [x] Cross-branch enrolment: staff limited to one branch can't see a student whose family's home branch is another one, so they can't enrol that student in a class at their own branch (D-051). Enrolments (TUI-33) must decide how this works. → The caller must reach both the student and the class; cross-branch enrolments go through the owner or staff with no branch limit (D-058)
- [ ] Cross-branch children on a roster: branch-limited staff of the class's branch see such a child's name but can't open the student or family record, so they have no guardian or emergency contacts for them (D-061). Attendance (TUI-34) was built keeping this: they mark the child by name and still get no contacts. This is an assumption from the build, not an owner decision (D-074): confirm it, or say which contacts the class's branch should get.

**Technical**
- [x] Parent sign-in: Clerk accounts (they count toward the 50k free users) or our own magic-link tokens for the portal? → Clerk users with passwordless email code or link, linked to a `parent` membership (D-021)
- [x] Org addressing: `/orgs/{orgId}` in the URL or a subdomain per centre? → Path-based `/orgs/{orgId}`; public pages use the org slug (D-020)
- [x] PDFs (invoices, receipts): render in the browser or server-side (Cloudflare Browser Rendering)? → Server-side with Browser Rendering (D-025)
- [x] Data region: the launch region for the shared D1 database, and when per-region storage is needed. → Oceania (`oc`); per-region only when a customer requires data residency (D-024)
- [x] Search: SQLite FTS5 or simple prefix search at first? → Prefix search on normalised names; FTS5 only if needed (D-026)
- [ ] Testing: Vitest + `@cloudflare/vitest-pool-workers` with local D1. Which flows get end-to-end tests first? (Suggested: onboarding → class setup → enrolment → invoice generation → payment.)
- [x] API docs in production: production is the only deployed environment and D-002 turned the docs off there, which left Swagger and the spec available locally only (D-064). Turn them on in production until there is another deployed environment? → On until launch: public at `/api/docs` and `/api/openapi.json` on the production Worker, off again as part of launch hardening (D-068). Since 2026-10-12 production is behind Cloudflare Access, so the docs aren't public while it is on (D-069)
- [ ] Cloudflare Workers plan: the account's plan couldn't be seen during the deploy, and nothing was changed. The cost model assumes Workers Paid at $5/month; on the Free plan the limits are lower and fail rather than bill. The owner needs to confirm which plan it is (D-066).

---

## 12. Suggested first steps in Claude Code

> **Status (2026-10-05):** steps 1–3 are done, except `apps/web`, which moved to the last phase
> (API-first, D-001). Step 4 is now API-only, tested through Swagger. Track progress on the
> board in [docs/project/](../project/README.md) (`pnpm board`, D-029); `/recommend-next` picks
> the next task. Production has been deployed since 2026-10-12, with Swagger on there until
> launch, behind Cloudflare Access (§4, D-066, D-068, D-069).

1. Scaffold the monorepo (pnpm + Turborepo): `apps/web` (Vite React TS), `apps/api` (Hono on Workers, `wrangler.jsonc` with D1, R2, Queues, Cron), `packages/shared`, `packages/db`.
2. Set up Drizzle for D1 with base column helpers (`id`, `org_id`, timestamps, `deleted_at`) and a prefixed-ULID id generator.
3. Build the auth and org middleware: verify the Clerk JWT, load the membership, run the permission check, and set up org-scoped repository base classes. Write tests showing that **cross-org access returns 404**.
4. Build the vertical slice: onboarding (create org) → branches/terms/grades/subjects → courses/classes/schedule → sessions → families/students → enrolments → attendance → invoice generation → record payment → parent portal invoice view.
5. Add Queues (email via Resend) and cron (reminders) once invoices exist.
6. Add Paddle billing and plan limits (student caps: Solo 30, Small 150).

---

## Appendix: rates used in the cost model (Oct 2026)
- **Cloudflare:**
  - Workers Paid: $5/month, includes 10M requests. Which plan the account is on isn't confirmed (D-066).
  - D1: 5 GB storage, 25B reads and 50M writes per month included; 10 GB max per database.
  - R2: $0.015/GB, no egress fees.
  - Browser Rendering (PDFs, D-025): some browser time included with Workers Paid each month, then billed per browser-hour.
- **Clerk:** Free up to 50k monthly retained users; Pro $25/month ($20 billed annually) adds MFA; B2B add-on $100/month (avoid it).
- **Resend:** Free 3,000 emails/month; Pro $20 for 50k.
- **Paddle:** 5% + $0.50 per transaction.
- **WhatsApp utility messages** (paid add-on later), from 1 Oct 2026: NZ/AU $0.0113, UK $0.022, North America $0.0034, India $0.0014, Sri Lanka $0.002.
- **Twilio SMS** (paid add-on later): NZ $0.105, AU $0.0515, UK $0.056.
- **Claude Haiku 4.5** (AI add-on later): $1 in / $5 out per million tokens.
- **Exchange rate:** 1.78 NZD per USD (2 Oct 2026).
