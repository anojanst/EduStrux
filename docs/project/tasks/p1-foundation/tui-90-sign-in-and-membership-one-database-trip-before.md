---
id: TUI-90
title: 'Sign-in and membership: one database trip before each request'
status: done
phase: P1
module: platform
priority: P1
size: M
endpoints: []
branch: task/tui-90-auth-one-trip
pr: 30
---

# TUI-90 Sign-in and membership: one database trip before each request

Every org endpoint spends two database trips before it does its own work: one for the user (by
Clerk id), one for the membership joined to the org. 75 of the 78 endpoints start this way, so a
plain list is 3 trips and nothing can be under 3.

Counted on 2026-10-13 by running the test suite (457 tests, 5,259 requests) through a
wrapper that counts D1 calls per request. The wrapper is not in the repo. A trip is one call to
D1: a statement, or a batch. On production each trip is a network round trip of about 40 ms
(estimated in TUI-89, not measured per trip).

| Endpoint         | Fewest | Typical | Most |
| ---------------- | ------ | ------- | ---- |
| `POST /orgs`     | 3      | 5       | 6    |
| `GET /me`        | 2      | 4       | 4    |
| `GET /audit-log` | 3      | 3       | 3    |
| `GET /jobs/{id}` | 3      | 3       | 3    |
| `GET /health`    | 0      | 0       | 0    |

The org is then read again inside the request, although the membership query has already joined
it. These endpoints read the org row two or three times: `POST /enrolments`, `POST /students`, `PATCH /students/{id}`, `PUT /sessions/{id}/attendance`, `GET /sessions`, `GET /students`, `PATCH /orgs/{id}`.

Ideas, none decided:

- One statement that joins the user, the membership and the org, or one D1 batch for the two.
- Keep the org the middleware loaded (timezone, currency) on the request, so services don't read
  it again.

Target, confirmed by the owner (D-102): about 3 database trips in sequence, which are sign-in,
one read stage and one write. Calls in flight together count once. This replaces the proposed
"about 200 ms on production, which is roughly 5 trips".

## Built (D-099)

Both ideas were built, and the counter is in the repo now.

- One statement loads the user, the membership and the org. An org endpoint spends one trip
  before its own work, not two.
- The org stays on the request. Services get it from `orgs.getOrg(ctx)`, which makes no trip in
  a request and reads it only in a queue job or a cron.
- Every response carries `Server-Timing: db;dur=<ms>;trips=<n>;stages=<n>`. A test reads the
  numbers from `call()` as `res.db.trips` and `res.db.stages`. `stages` is the trips in
  sequence, the number the budget is held to.

Counted in the test suite with the same requests before and after:

| Request                                         | Before | After |
| ----------------------------------------------- | ------ | ----- |
| `GET /orgs/{id}`                                | 3      | 1     |
| `GET /audit-log`, `GET /jobs/{id}`              | 3      | 2     |
| `PATCH /orgs/{id}`                              | 5      | 2     |
| `GET /students`                                 | 6      | 4     |
| `POST /students`, with a birth date and a grade | 12     | 8     |
| `PATCH /students/{id}`, the same two            | 13     | 9     |
| `POST /enrolments`                              | 12     | 9     |
| `GET /sessions?studentId`                       | 9      | 6     |
| `PUT /sessions/{id}/attendance`, one student    | 11     | 8     |

Not changed: `GET /me` (2 trips) and `POST /orgs` (4, or 5 when the slug made from the name is
taken). Both sign in with one trip already. `GET /me` could join its memberships into that trip,
and `POST /orgs` reads the new org back after writing it.
