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

## TUI-50 Clash detection

**Q-11 · A report to ask for, or a check on every save?**
Options: (a) `GET /timetable/clashes?from&to` that lists clashing pairs; (b) also warn, or refuse,
when a schedule, a session move or an enrolment would make one.
**Built: (a)** only. Nothing is refused: clashes are sometimes intended (two groups sharing a big
room). The web app can call it after a save. Warnings on save can come with the calendar UI.

**Q-12 · What counts as a clash.** Built, for two scheduled lessons on one date whose times
overlap (touching end to start isn't): the same room; the same teacher; a student whose
enrolments cover that date in both classes (withdrawn ones up to their last day); and a **grade**
clash, two different courses of one grade level at once (two groups of the same course aren't).
Cancelled lessons are ignored.

**Q-13 · Limits and who.** Built: at most 92 days per request (400 beyond), not paged. Uses
`classes:read` and the class reach: branch staff see their branches' lessons only (so a teacher
shared with another branch shows no clash to them), a teacher their own classes. A parent gets
403, as for an accountant.

## TUI-69, TUI-65, TUI-70 Messages, email sending, notification settings

**Q-14 · Which guardians get a message?**
Options: (a) every guardian of the family; (b) only the billing contact; (c) only guardians with
`preferredChannel: email`.
**Built: (a)**, one recipient row per guardian; those without an email address get the portal only
(`emailStatus: skipped`). `preferredChannel` is still only stored: SMS and WhatsApp are paid
add-ons, so everyone with an address is emailed.

**Q-15 · What the audiences mean.** Built: `all`; `branch` = families whose home branch it is;
`grade` = students with that grade level in the current academic year; `subject`, `class`,
`teacher` = students with an active enrolment in such a class; `custom` = family ids (404 for one
the caller can't reach). The audience is cut down to the families the sender reaches: branch
staff their branches', a teacher their students'. Unknown ids reach nobody; an audience that
reaches nobody is 422.

**Q-16 · Who reads which messages?**
Built: the owner reads every message, automatic ones included; everyone else reads only the
announcements they sent themselves. Parents read theirs at `GET /portal/messages` (added, not in
the endpoint list) and get 403 on `GET /messages`. Templates: anyone who sends can list them;
only the owner adds, changes or deletes them (`org:write`).

**Q-17 · How email is sent.**
Built: each email is a queue message; the consumer renders it (plain text body → escaped HTML,
English catalog in `apps/api/src/email/catalog.ts`, D-015) and posts it to Resend's API with an
`Idempotency-Key` per recipient, so a retried try never sends twice. 429 and 5xx are retried with
backoff up to the queue's 5 retries, then marked `failed`; other refusals fail at once.
Configuration the owner must add before email works (not done: no infra changes this session):
the `RESEND_API_KEY` secret and an `EMAIL_FROM` value (a sender on a domain verified with
Resend), and optionally `APP_URL` for links in invitation emails. Without them every email is
marked `failed` with "Email sending is not set up". Tests force both empty so they can never send.

**Q-18 · Automatic messages and their settings.**
Built: `GET|PUT /notification-settings` (owner writes; every role reads). Three switches,
`sessionChanges`, `invoiceIssued`, `overdueReminders` (all on by default), the reminder days
after the due date (default 1, 7, 14), the local hour reminders go out at (default 9) and a
reply-to address. `PUT` replaces all of them, the later save winning (no `updatedAt`).
Automatic messages are stored like announcements (`kind: automatic`, with `event`), so the
portal shows them and their delivery is tracked.

**Q-19 · Issuing an invoice now sends it.** D-095 said issuing sends no email yet. Built: issuing
queues an `invoice_issued` message to the family's guardians (total, due date, bank reference),
unless `invoiceIssued` is off. The PDF isn't attached (see TUI-59).

**Q-20 · Automatic messages are written by the queue, not the request.** To keep requests within
the D-102 budget, a request only queues a "notice"; the email consumer applies the settings,
finds the guardians, writes the message (with the requester as the audit actor) and queues its
emails. So the message appears a moment after the response.

## TUI-49 Session one-off changes

**Q-21 · What can change, and when.**
Built: `PATCH /sessions/{id}` changes `date`, `startTime`, `endTime`, `roomId`, `teacherId` or
`status` (cancel, or put back on) of a lesson that hasn't started (422 once it has), never to a
time that has passed (422). Another of the class's lessons at the new date and time is 409.
Takes `updatedAt` (409 when stale). `classes:write` with the class reach.

**Q-22 · Moved lessons and the weekly generator.**
Built: a moved lesson remembers where it was first scheduled (`movedFrom`, new columns
`sessions.original_date`/`original_start_time`). Saving the weekly schedule again never re-adds
its first slot, nor moves or removes it. Moving it back clears `movedFrom`.

**Q-23 · Which changes families hear about.** Built: a move to another date, a new start time on
the same date, a cancellation and a lesson put back on. A new end time, room or teacher alone
sends nothing. `notify: false` sends nothing; an optional `note` is added to the message. The
message goes to the families of the students expected at the lesson, on its old date and its new
one.
