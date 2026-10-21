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

## TUI-46 Enrolment transfer and withdraw with pro-rata

**Q-5 · One route or three?**
Options: (a) `PATCH /enrolments/{id}` for all of it, as the handoff lists: plain changes,
`status: "withdrawn"`, or `transfer: {...}`; (b) `POST /enrolments/{id}/withdraw` and
`/transfer` actions, as §5's "Actions" convention would have it.
**Built: (a)**, to match the endpoint list. The answer isn't the bare enrolment but
`{ enrolment, transferredTo, invoices }`, since a transfer makes a second enrolment and both
can change invoices.

**Q-6 · What does "pro-rata" do to invoices already made?**
Options: (a) charge a **draft** invoice's line again for the new dates, pro rata by lessons, at
the price it was charged at (D-093), and only **report** an issued invoice's line with what it
would charge now; (b) also change issued invoices; (c) only report, change nothing.
**Built: (a).** Issued invoices stay fixed (D-095) and credits are v1.1, so staff void and
generate again while nothing is paid. A draft left with no lines is voided. Pack lines are left
alone: packs are bought up front and carry over. A change of `priceOverride` touches no invoice:
it applies from the next run.

**Q-7 · Is a withdrawn student still billed and on past rosters?**
Built: yes, up to the last day. A withdrawal sets `endDate` and `status: withdrawn`. Invoice runs
now bill withdrawn enrolments for the lessons before the student left (otherwise withdrawing
before a run would make those lessons free), and a lesson's attendance and notes rosters show
them on lessons up to their last day. Only an active enrolment still gives a teacher or a parent
their reach (D-060), and only an active one holds a place.

**Q-8 · Withdrawing before the enrolment starts.**
Built: with no `endDate`, a withdrawal ends today, or the day before the start when that is still
to come, so no lesson is covered. An `endDate` before the day before the start is 400.

**Q-9 · Transfer details.**
Built: the new enrolment starts on `transfer.startDate` (default today, or the new class's first
day when later); the old one ends the day before. The caller must reach the new class (404); the
same rules as a new enrolment apply (already enrolled 409, full 422, dates inside the class 422).
The price override is not carried over; send `transfer.priceOverride` to set one. One audit row,
`enrolment.transferred`, holds both.

**Q-10 · Who may change an enrolment?**
Built: `classes:write`, reaching the enrolment through its class or its student, as reads do.
So the class's branch can withdraw a child from another home branch. Teachers, parents and
accountants get 403.

Known limit: the change reads in two stages before its write (four with sign-in), one over the
D-102 budget, because the class and its lessons are known only once the enrolment is read.
