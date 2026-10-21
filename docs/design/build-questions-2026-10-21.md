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

## TUI-55 Make-up policy, credits and booking

**Q-24 · What earns a credit?**
Built, as an owner-set policy (`GET|PUT /makeup-policy`), off until saved: an `excused` mark
(on by default) and/or an `absent` mark (off by default) earns one credit per student and missed
lesson, and with `requireNotice` (on by default) only when an absence notice covering the date
was given before the lesson started. Only students enrolled for the lesson earn one, not those
making one up. A credit lapses `expiryDays` after the missed lesson (default 60; null = never).
Changing the mark while the credit is unused takes it back; a used credit stays.
Centre-cancelled lessons earn nothing automatically (bulk credits are v1.1).

**Q-25 · Booking rules.** Built: staff with `classes:write` book a credit into a scheduled lesson
still to come, on or before the credit's last day, of the same course when `sameCourseOnly` (on
by default), that the student isn't already in, with a place free (enrolled students covering
the date plus bookings, against the class's capacity). The student then shows on that lesson's
attendance roster and can be marked there. Cancelling a booking before the lesson gives the
credit back. Parents see credits (`GET /portal/makeup-credits`) but can't book (parent make-up
booking is v1.1). A unique index stops one credit being booked twice at once.

**Q-26 · Cost.** Marking attendance now reads the policy, the lesson's credits and who is
booked in, in the same read stage: still 3 stages, but 3 more trips (11 instead of 8). Reading a
roster costs one more trip. Folding the policy into the org row (read at sign-in for free) would
save one; not done.

## TUI-58 Discount rules

**Q-27 · How the kinds work.** Built (one rule type, six kinds, each a percentage or an amount off
a line's charge before tax, or for a bundle a fixed total):
- `sibling`: in a family with `minCount` (default 2) or more children billed in the run, every
  child but the one charged most gets it (ties: the earliest student).
- `multi_class`: a student with `minCount` or more lines in the run gets it on all but their
  dearest line. Lines priced by a bundle neither count nor get it (D-079).
- `early_bird`: enrolments made on or before `cutoffDate` (the enrolment's creation date in the
  org's timezone), in one term's run or any. Alternative not built: paid before a date, which
  would need credit notes.
- `scholarship` (students) and `manual` (families): standing discounts while the rule is active.
  A one-off discount on one invoice isn't built: void and generate again.
- `bundle`: a student billed in the run for every one of `courseIds` pays `fixedPrice` for those
  lines together (split across them by charge), or the percentage or amount off each.

**Q-28 · Stacking.** Built: rules apply in id order, each worked out on the charge before
discounts, and together take off at most the whole charge. Tax is worked out on what is left
(an inclusive rate is split out of the discounted charge).

**Q-29 · Where discounts show and who writes them.** Built: each invoice line carries `discount`
and `discounts` (`[{ ruleId, name, amount }]`), new fields on the line. Discounts apply when a
run makes the invoice; a rule changed later doesn't touch invoices already made. When an
enrolment's dates change (TUI-46), a draft line's discounts shrink or grow with its charge. Only
the owner writes rules, as for org-wide price rules (D-111); branch staff and accountants read;
teachers and parents get 403.

## TUI-62, TUI-63 Dashboard and money reports

**Q-30 · What the dashboard shows.** Built (`GET /reports/dashboard`, `reports:read`, as far as
the caller reaches): families, students with an active enrolment, classes still running, today's
lessons (cancelled, with marks), students away today, lessons in the last 14 days with no marks,
and make-up credits waiting. `money` (owing, overdue and how many invoices, received this month,
drafts) only for roles with money reports: the owner and branch managers. Front desk ("Limited"
in §6) and teachers get the counts without money. An accountant has no `reports:read`, so 403.

**Q-31 · Money report definitions.** Built (`GET /reports/money?from&to`, `reports:money`, at
most 366 days): **invoiced** = totals of invoices *issued* in the dates (by `issuedAt` in the
org's timezone), void ones left out; **received** = payments by `receivedOn`; both by month and
received by method. **Aged debt** = what is owed today on issued and part-paid invoices,
bucketed by days past the due date (not due / 1–30 / 31–60 / 61–90 / 90+), whatever the dates.
**Tax collected** = tax on the lines of invoices issued in the dates, by rate (accrual basis).
Alternative not built: tax on payments received (cash basis), which needs tax per allocation.

**Q-32 · Export.** The accountant's "read + export" isn't a CSV of this report yet; the full
data export (TUI-78) carries the raw invoices and payments.

## TUI-59 Invoice PDF and payment receipts

**Q-33 · How PDFs are made without an infra change.** D-025 chose Cloudflare Browser Rendering.
Its Worker binding would be a wrangler/infra change, so it wasn't added. Built instead: the API
renders the printable HTML itself (English catalog, the org's locale and date format, brand
colour, tax number; nothing org-written trusted as HTML) and posts it to Browser Rendering's
**REST API**, which needs no binding. The owner must set two secrets before PDFs work:
`BROWSER_RENDERING_ACCOUNT_ID` and `BROWSER_RENDERING_TOKEN` (an API token with Browser
Rendering: Edit). Until then a PDF is **503** `unavailable` (a new error code), and
`?format=html` gives the printable page, which a browser can print to PDF. Browser time may be
billed on the account's plan (owner's call, D-065).

**Q-34 · Invoice numbers.** Invoices have no sequential number. Built: the paper shows a short
reference, the last 8 characters of the invoice id in capitals (the same for receipts). A
sequential, per-org invoice number (some tax authorities require one) would need a counter and a
migration: say if you want it.

**Q-35 · Not built here.** Batch PDF jobs (all invoices of a run as one file), and attaching the
PDF to the invoice email: the email links to nothing yet and carries the amounts in its text.

## TUI-45 Year-end promotion

**Q-36 · How promotion works.** Built: `POST /students/promote` (`people:write`, a job, takes
an `Idempotency-Key`) with `fromAcademicYearId`, `toAcademicYearId` (must start after, 422) and
optional `exceptions` (`{ studentId, gradeLevelId | null }`: repeat a grade, skip to any grade,
or none). Every student with a grade in the old year gets the next grade in the org's grade
order in the new year; the last grade gets none (they have finished). A student who already has
a grade in the new year keeps it, so a second run changes nothing. Branch staff promote only
their branches' students. One `students.promoted` audit row for the run (D-045). Enrolments
aren't touched: classes are per term, and roll-over is v1.1.

## TUI-47 Public enquiry and enrolment forms

**Q-37 · What the public routes are.** Built, with no sign-in, by the org's slug (D-020):
`GET /api/v1/public/{orgSlug}/form` (the org's name, branches, running classes with their weekly
times, subjects, grade levels and courses: what the form offers), `POST …/enquiries` and
`POST …/enrolment-requests`. An org that is suspended or cancelled is 404. Added for staff, not
in the endpoint list: `GET /enquiries` and `PATCH /enquiries/{id}` (`new` / `handled`), with
`people:write`. A lead pipeline is v1.1.

**Q-38 · Bot protection and rate limits without infrastructure.** Built in the app: a hidden
`website` field (filled in = a bot, answered as if received, nothing stored); at most 10 forms
an hour from one address to one org (429), counted from a SHA-256 of the IP (the address itself
isn't stored); and **Cloudflare Turnstile** once the owner sets the `TURNSTILE_SECRET_KEY`
secret (then a form without a valid `turnstileToken` is 400). Cloudflare rate-limit rules
(TUI-81) would sit in front of this; they are an infra change and weren't made.

**Q-39 · Approving.** Built: `POST /enrolment-requests/{id}/approve` (`classes:write`, takes an
`Idempotency-Key`) adds a new family in `branchId` (default: the request's, else the first
class's branch) or joins `familyId` (one on record, against duplicates; its guardian with the
same email is reused), then the guardian, each child and their enrolments, with the usual rules
and the approver's reach. A class that refuses (full, outside its dates) is listed in
`result.skipped` and the rest goes ahead. These are separate writes, each with its own audit
row, not one batch: a failure halfway leaves what was made and the request still pending.
Branch staff see requests naming one of their branches, or none. Nobody is emailed about a new
request or the decision yet.

## TUI-61 File uploads to R2

**Q-40 · Signed links without R2 credentials.** R2's own presigned URLs need S3 API keys (an
infra/credentials change). Built instead: the Worker serves the links itself over the existing
`FILES` binding. `POST /files/upload-url` makes the file's record and a link to `PUT` its bytes
(15 minutes); `GET /files/{id}` gives a download link (5 minutes). Each link carries an expiry
and an HMAC of method, file id and expiry; a wrong or stale one is 404. The owner must set one
secret, `FILES_SIGNING_SECRET` (any long random string); without it these routes are 503.
Files stream through the Worker, so they're kept small: CSV, PDF, PNG or JPEG, at most 10 MB.

**Q-41 · Who.** Uploading needs `people:write` (owner, branch managers, front desk: imports are
the main use). A file is read by the member who uploaded it and the owner; anyone else 404, as
for jobs (D-018). Files for an import are removed by the daily clean-up after a week.

## TUI-60 Spreadsheet import

**Q-42 · CSV only.** Built: imports read **CSV** (RFC 4180: quotes, commas and newlines in
fields, a BOM). Excel `.xlsx` would need a parsing library in the Worker; staff save the sheet
as CSV. At most 1000 rows per import.

**Q-43 · What a row is.** Built: one row is one **student** with their **family** and one
**guardian**. Fields: student first and last name (required), date of birth (`YYYY-MM-DD`, or
day/month/year in the org's date format), notes, grade (a grade level's name, for the current
academic year), family name (default: the guardian's or student's last name), branch (a branch's
name, or a default branch), address, guardian first and last name, email, phone, relationship.
Rows with the same family name, branch and guardian email (or guardian name, with no email) are
one family; its first guardian is the billing contact.

**Q-44 · Flow and duplicates.** Built: `POST /imports` (from an uploaded file) → headers, row
count, first 5 rows; `PATCH /imports/{id}` sets the mapping and checks every row (the first 100
problems, with spreadsheet row numbers; `ready` with none); `POST /imports/{id}/commit` runs a
job that adds everything in one batch with one `import.committed` audit row, or nothing.
Records already in the org are **not** matched: an import adds new families even when a name
is on record. Run the duplicate check (TUI-43) or search first. Branch staff can only import
into their own branches. An import is seen by whoever started it and the owner.

## TUI-78 Full data export

**Q-45 · Format and who.** Built: `POST /exports` (owner only) runs a job that writes **one JSON
file** with every org table (`{ format, version, exportedAt, org, tables: { name: rows } }`,
deleted rows included, as a backup holds them; internal columns such as normalised names, IP
hashes, token hashes and R2 keys left out; members' names and emails from `users`). The file is
kept a week; `GET /exports/{id}` gives a 5-minute download link once done. Per-table CSVs in a
zip would need a zip library: say if you want CSV. The export reads every module's tables
directly (a documented exception to "a repository reads only its own module's tables").

---

## Where the session stopped (usage limit)

Built on this branch, each committed with tests (964+ passing at the last full run):
TUI-43, 46, 50, 69, 65, 70, 49, 55, 58, 62, 63, 59, 45, 47, 61, 60, 78.

Not built yet, in the order planned:
- TUI-67 hourly cron: overdue reminders (needs an `invoices.reminded_days` column) and make-up
  credit expiry (`attendance.expireCredits` exists, not yet called from the cron).
- TUI-68 daily cron: extend open-ended classes' sessions, `cleanExpired` files (exists, not yet
  wired into the cron), nightly per-org backup (`exportDocument` exists).
- TUI-71 Clerk and Resend webhooks (a `webhook_events` table already exists for idempotency).
- TUI-72 parent portal sign-in (mostly Clerk dashboard set-up; invitations already link parents).
- TUI-73 Paddle, TUI-74 sign-up/trial/plan limits, TUI-75 super-admin console.
- TUI-79 privacy controls, TUI-82 cross-org test sweep. TUI-80, 81, 83, 85 and 86 need the
  owner or infrastructure.
- The design docs (`handoff.md`, `decisions.md`) and the task files haven't been updated for
  this session's work: this file holds the decisions to confirm first.
