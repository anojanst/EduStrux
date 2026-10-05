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
