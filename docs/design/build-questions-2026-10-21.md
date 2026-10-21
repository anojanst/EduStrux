# Build questions: rest of the MVP API (session of 2026-10-21)

The owner asked for the remaining MVP endpoints to be built in one session, on one branch
(`task/tui-43-82-remaining-mvp-api`), without stopping for questions. Where a question came up,
the recommended option was taken and recorded here for the owner to confirm or change.

Each entry: the task, the question, the options, what was built, and why. Nothing here is an
owner decision until the owner says so; once confirmed, it moves into
[decisions.md](decisions.md) as a D-number.

Rules for the session, from the owner:

- No infrastructure changes: no new Cloudflare resources or bindings, no wrangler changes that
  need provisioning, no deploys, no paid products turned on.
- No pull request. Commits go to the one branch.

---

## TUI-43 Search with duplicate warnings

**Q-1 · How are duplicate warnings given?**
Options: (a) a check the client calls before saving, `GET /search/duplicates`; (b) a `duplicates`
field on the `POST` responses for families, students and guardians, after the record exists;
(c) refuse the `POST` with 409 unless the client confirms.
**Built: (a).** The client warns while the form is still open, and nothing is saved twice.
`POST` responses keep their shapes. The task's `endpoints` named only `GET /search`, so this adds
a route.

**Q-2 · Whose records does a duplicate check look at?**
Options: (a) only what the caller reaches, as every other read; (b) the whole org, so branch
staff learn that a family exists at another branch.
**Built: (a).** It leaks nothing across branches. The cost: front desk at one branch isn't warned
about the same child at another branch. The owner and staff with no branch limit see everything.

**Q-3 · How are phone numbers matched?**
Built: exactly, on the digits alone (`+64 21-555 0100` and `64215550100` match; `021 555 0100`
doesn't, as no country code is assumed). Stored in a new `guardians.phone_norm` column with a
backfill migration. Prefix or country-aware matching would need a phone library.

**Q-4 · Who can search?**
Built: `people:read` (`GET /search`), with each role's usual reach: a teacher finds their
students and those students' families and guardians, a parent their own families. The duplicate
check needs `people:write`. An accountant gets 403 on both.

Also built, not a question: a search for an 8-character code also finds the family with that
bank reference, so a bank transfer can be matched to a family from the search box.
