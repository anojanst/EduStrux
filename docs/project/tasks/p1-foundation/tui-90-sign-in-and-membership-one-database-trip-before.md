---
id: TUI-90
title: 'Sign-in and membership: one database trip before each request'
status: todo
phase: P1
module: platform
priority: P1
size: M
endpoints: []
branch:
pr:
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

Proposed target, for the owner to confirm: about 200 ms on production, which is roughly 5 trips.
