# UI design system

The look and behaviour of the web app (staff app and parent portal, one React PWA). Every screen
follows this file; when a screen needs something it doesn't cover, add it here first.

- **Source:** the Home dashboard made in Figma Make,
  <https://finch-coal-95289917.figma.site/>, chosen by the owner on 2026-10-22 as the direction
  for the whole app. Colour tokens below are taken from its CSS; type sizes are set here, since
  the Figma page scales its text with the window.
- **Status:** direction agreed. The implementation choices in [§10](#10-building-it) were
  settled when TUI-23 was built (D-158).
- **Related:** stack and principles in [handoff.md](handoff.md) §1 and §3; strings and formatting
  in D-015.

---

## 1. Principles

1. **Calm and quick to scan.** Staff use it all day for repetitive work: dense but readable
   lists, one clear primary action per area, few clicks for common jobs.
2. **Mobile first where people are on phones.** Parents and teachers use phones; admin screens
   are desktop first and still work on a tablet and a phone.
3. **Borders, not shadows.** Surfaces are white cards with a 1px border on a light grey canvas.
4. **Colour carries meaning, never alone.** Status always has a label or an icon as well.
5. **Show only what the role can use.** Hide what a role can't do rather than disabling it. The
   API is the authority: a 403 or 404 is still handled gracefully.
6. **Real words.** Sentence case, plain language, no jargon ("Mark attendance", not "Submit
   attendance records").

---

## 2. Colour

Defined as CSS variables on `:root`, with these exact names (they match the Figma source).

| Token              | Value     | Use                                                     |
| ------------------ | --------- | ------------------------------------------------------- |
| `--brand`          | `#155d63` | Primary buttons, links, active nav text, focus ring     |
| `--brand-hover`    | `#104c51` | Primary button hover and pressed                        |
| `--brand-soft`     | `#e7f2f1` | Selected rows, icon tiles, avatar backgrounds           |
| `--sidebar`        | `#123f43` | Sidebar background                                      |
| `--sidebar-raised` | `#1a4d52` | Org switcher card and hovered items on the sidebar      |
| `--sidebar-text`   | `#c9d9da` | Sidebar nav items (active item: white pill, brand text) |
| `--sidebar-strong` | `#ffffff` | Names and hovered items on the sidebar                  |
| `--sidebar-active` | `#ffffff` | The active nav item's pill and the sidebar logo tile    |
| `--text`           | `#192229` | Body text and headings                                  |
| `--muted`          | `#66747d` | Secondary text, labels, metadata                        |
| `--subtle`         | `#8b979e` | Placeholders, timestamps, disabled text                 |
| `--border`         | `#e2e7e9` | Card and divider borders                                |
| `--border-strong`  | `#d7dfe1` | Input and secondary-button borders                      |
| `--surface`        | `#ffffff` | Cards, inputs, menus                                    |
| `--canvas`         | `#f6f8f9` | Page background                                         |
| `--success`        | `#277a5b` | Paid, present, delivered, active                        |
| `--success-soft`   | `#eaf6f0` | Its badge and tile background                           |
| `--warning`        | `#9a6015` | Overdue soon, late, trial ending, part paid             |
| `--warning-soft`   | `#fff4df` | Its badge, tile and banner background                   |
| `--danger`         | `#b34444` | Overdue, absent, void, bounced, destructive actions     |
| `--danger-soft`    | `#fceded` | Its badge and tile background                           |
| `--info`           | `#325ea8` | Neutral information, issued, links in notices           |
| `--info-soft`      | `#edf3fc` | Its badge and tile background                           |

- **Org themes (D-165, D-166).** The eight brand and sidebar tokens above (`--brand`,
  `--brand-hover`, `--brand-soft`, `--sidebar`, `--sidebar-raised`, `--sidebar-text`,
  `--sidebar-strong`, `--sidebar-active`) follow the org's colour theme; the values in the table
  are the default, **teal**. The other dark-sidebar themes are ocean, indigo, violet, berry,
  forest, amber and graphite; the light-sidebar ones (pale sidebar, dark text) are Light Teal,
  Sky, Lavender and Rose. All are defined once in the shared theme catalog and used by the web,
  PDFs and emails. Every other token stays the same in every theme. Inside an org the
  app sets the six variables on `:root`; outside one (sign-in, sign-up) it's teal.
- **Class colours.** Each class gets a colour for its left bar and dot in lists and the calendar,
  from a fixed palette of 8 that read on white: indigo `#5b6ac4`, amber `#d4843b`, green
  `#3f9b6e`, rose `#c4566e`, sky `#3a8bc4`, violet `#8a5bc4`, teal `#2f9a94`, slate `#6b7a86`.
  Chosen by class id, so a class keeps its colour everywhere.
- **Avatars.** Initials on a soft tint (brand soft by default; the org avatar uses a warm sand,
  `#f0c782` with `#594017` text).
- **Contrast.** All text pairs above meet WCAG AA at the sizes used, in every theme. Don't put `--subtle` text on
  `--canvas` below 14px.
- **Dark mode.** Not in the MVP. Tokens are variables so it can be added without touching
  components.

---

## 3. Typography

Font: **Inter** (`Inter, ui-sans-serif, system-ui, sans-serif`), with tabular numbers
(`font-variant-numeric: tabular-nums`) for money, times and counts.

| Style         | Size / line height | Weight | Use                                                                 |
| ------------- | ------------------ | ------ | ------------------------------------------------------------------- |
| Page title    | 28 / 34            | 400    | "Good morning, Olivia", page names; letter-spacing −0.02em          |
| Stat value    | 26 / 32            | 700    | Money and counts on stat cards; letter-spacing −0.01em              |
| Section title | 17 / 24            | 500    | Card headings ("Today's lessons")                                   |
| Body          | 14 / 20            | 400    | Default text, table cells                                           |
| Body strong   | 14 / 20            | 600    | Row titles, names                                                   |
| Label         | 13 / 18            | 500    | Nav items, buttons, form labels                                     |
| Meta          | 12 / 16            | 400    | Secondary lines under a row title, timestamps                       |
| Overline      | 12 / 16            | 600    | Uppercase, letter-spacing 0.05em, `--muted` ("MONDAY, 24 FEBRUARY") |
| Badge         | 12 / 16            | 600    | Status badges and counts                                            |

No text below 12px anywhere (the Figma source has 9–10px badges and metadata at small window
widths; the app doesn't).

---

## 4. Spacing, shape and motion

- **Spacing:** 4px base. Use 4, 8, 12, 16, 20, 24, 32, 40. Card padding 20px (16px on phones);
  gap between cards 16px; page padding 32px desktop, 16px phone.
- **Radius:** 8px for buttons, inputs, nav items and small tiles; 12px for cards, sheets and
  dialogs; full for badges, pills and avatars.
- **Borders:** 1px `--border` on cards and dividers between list rows. No drop shadows on cards;
  menus, popovers and dialogs get one soft shadow (`0 8px 24px rgba(25,34,41,.12)`).
- **Icons:** line icons, 1.5px stroke (Lucide). 16px inline, 20px in nav and icon buttons. Icon
  tiles on stat cards: 32px square, 8px radius, soft tint background with the matching colour.
- **Motion:** 150ms ease-out for hover, press and open; no decorative animation. Respect
  `prefers-reduced-motion`.
- **Focus:** a 2px `--brand` ring with 2px offset on every focusable element.

---

## 5. Layout

### App shell, desktop (≥ 1024px)

- **Sidebar**, 248px wide, `--sidebar` background, full height:
  - Logo mark and name at the top.
  - **Org switcher**: a card on a slightly lighter teal with the org avatar, "Organisation"
    overline and org name; opens the list of the user's orgs (from `GET /me`).
  - **Branch selector**: "All branches" with a pin icon; filters every list that has a branch.
    Hidden for single-branch orgs and for staff limited to one branch.
  - **Nav**: Home, Timetable, Classes, Families & Students, Attendance, Invoices, Payments,
    Messages, Reports, Settings, Branches (map-pin icon) and Courses for roles that change classes (D-178, D-170), and Theme for owners (D-165). Timetable is for roles with `classes:read` except parents (D-176). Invoices and Payments are for staff with `billing:read` (D-172), and so is Pricing (tag icon, under Settings; not for parents, D-175). Items are 40px high, icon + label; the active item is a pill
    in `--sidebar-active` (white on a dark theme) with `--brand` text. A count badge (`--danger`, white text) sits at the right edge.
    Items the role can't use are left out.
  - **User footer**: avatar, name and role; opens profile and sign out.
- **Top bar**, 64px, white with a bottom border. It shows for any role that can search or
  create (D-164, D-174):
  - Global search: full-width field with a search icon and a `⌘K` hint, finding families,
    students and guardians (`GET /search`).
  - **+ New**: the primary button ("New" with a plus icon) at the right, with a menu of what the
    role may create, each with an icon, opening the same dialog as its own page (D-174):
    Family (`people:write`, Add family), Class (`classes:write`, Add class), Payment
    (`billing:write`, Record payment for any family that owes) and Announcement
    (`messages:write`, New announcement, D-183). Student and enrolment aren't in it: a student
    is added inside a family, an enrolment from a class. Parents and accountants have no
    "+ New"; a teacher's has only Announcement.
  - Notifications bell with a dot when there's something new.
- **Banner slot** under the top bar, full width (see §6, Banners).
- **Content**: the full width beside the sidebar, edge to edge, with 32px padding (16px on
  phones). The profile page too, beside its section menu (tried on 2026-10-22; revert to a
  720px column if wide forms read badly).
  - **Rule (D-182):** every page, staff and parent portal alike, fills the content area. A
    page's outer wrapper never has a max width, even when a Figma design shows a narrower
    column. Only a paragraph of running text (an explainer) and dialogs get a max width.
- **Collapsing:** a button at the top of the sidebar turns it into a 72px icon rail (logo mark,
  org avatar, nav icons, profile avatar and sign out), with each label shown beside its icon on
  hover and keyboard focus. The choice is remembered on that browser.

### Tablet (640–1023px)

The sidebar is always the 72px icon rail; labels show on hover. Its top button ("Open menu")
opens the full sidebar as a slide-out drawer. The top bar keeps the full search field and "New"
with its label. The remembered collapse choice applies only from 1024px (D-185).

### Phone (< 640px)

- Top bar: logo, search icon and **+ New** as a 44px brand icon button; no menu button (the tab
  bar's More replaces it). It grows by the top safe area in an installed iPhone app. Nothing may
  overflow the screen width.
- **Bottom tab bar** for every role (D-180, D-185). Staff (owner, branch manager, front desk):
  Home, Timetable, Families, Invoices, More. Teacher: Today, Timetable, Messages, More. Parent:
  Home, Timetable, Invoices, Messages, More. Other roles get Home, whichever of Timetable,
  Families and Invoices they have, then their next main (not settings) areas up to four tabs
  (accountant: Home, Invoices, Payments, More).
- **More**: for staff it opens the full menu drawer; for parents it's the portal More page. It's
  lit while the drawer is open or on a menu area that isn't a tab (Team, Classes, Theme), not on
  a page reached from inside one (a lesson, a student).
- **Clear of the tab bar:** pages end 90px above the bottom (plus the safe area); sticky save and
  action bars sit above the tab bar, and so do toasts.
- Stat cards sit in a **2 × 2 grid**, not a sideways scroller.
- Tables become stacked rows (title, meta line, status badge, chevron).

### Page header pattern

Overline (date or breadcrumb), page title, one muted subtitle line, and on the right either a
context chip (e.g. "All branches · 3 lessons today") or the page's primary action.

---

## 6. Components

All are reusable with variants; build each once.

### Buttons

| Variant         | Look                                             | Use                                    |
| --------------- | ------------------------------------------------ | -------------------------------------- |
| Primary         | `--brand` fill, white text, 600 weight           | The one main action in an area         |
| Secondary       | White, `--border-strong` border, `#34444a` text  | Row actions ("Mark attendance")        |
| Warning outline | `#fffdf8` fill, `#e5ca8b` border, `#775218` text | Actions inside a warning banner        |
| Ghost / link    | No fill, `--brand` text, optional trailing arrow | "View timetable →", "Review drafts →"  |
| Danger          | `--danger` fill, white text                      | Void, delete, erase (always confirmed) |
| Icon            | 36px square, ghost                               | Bell, close, overflow menu             |

Heights: 40px default, 32px small (inside rows), 44px minimum on phones. Loading shows a
spinner in place of the icon and keeps the width.

### Status badges

Pill, 12px text, soft background with the strong colour as text, optional leading icon.

| Status (API value)                                                                   | Colour                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Invoice `draft`                                                                      | neutral (grey)                              |
| Invoice `issued`                                                                     | info                                        |
| Invoice `part_paid`                                                                  | warning                                     |
| Invoice `paid`                                                                       | success                                     |
| Invoice `void`                                                                       | neutral, strikethrough label                |
| Overdue (issued or part paid, past its due date)                                     | danger                                      |
| Attendance `present` / `late` / `absent` / `excused`                                 | success / warning / danger / neutral        |
| Enrolment `active` / `withdrawn`                                                     | success / neutral                           |
| Email `queued`, `sent` / `delivered` / `bounced`, `complained`, `failed` / `skipped` | neutral / info / success / danger / neutral |
| Session `scheduled` / `cancelled` / moved                                            | neutral / danger / warning                  |
| Consent granted / refused / not asked                                                | success / danger / neutral                  |
| Make-up credit `available` / `used` / `expired`                                      | info / success / neutral                    |
| Org `trialing` / `active` / `past_due` / `suspended`, `cancelled`                    | warning / success / warning / danger        |

Labels are the plain words ("Part paid"), never the raw API value.

### Stat card

White card, 12px radius, 20px padding. Label (14px `--muted`) top left, icon tile top right, value
(stat value style), then one supporting line: a muted note ("Across 23 families"), a badge with a
note ("4 invoices need attention"), a trend ("↑ 8.2% from last month", success or danger) or a
ghost link ("Review drafts →"). The whole card links to the matching list.

### Lesson row

Left: start time (body strong) over end time (meta), with a 3px class-colour bar. Middle: class
colour dot, class name (body strong) over "Room · Teacher" (meta). Right: the row action
("Mark attendance" secondary button) or its result ("✓ Attendance marked" success badge), then a
chevron. Cancelled lessons show the class name struck through and a "Cancelled" badge; moved
ones a "Moved from Thu 4:00" meta line.

### Attention row

Icon tile in the row's colour, title over a meta line, a count on the right and a chevron. Used
for "Needs attention" (students away, make-up credits to book, overdue invoices).

### Activity row

Initials avatar, a sentence title ("Payment received from Ngata family"), a meta line
("$450.00 · INV-0042", D-173), relative time on the right.

### Quick action tile

Icon tile, title and a one-line description, chevron; two columns on desktop, one on phones.

### Lists and tables

- Header row in label style on `--canvas`; rows 52px, divided by `--border`; hover `--canvas`.
- Sorting by clicking headers that support it; filters as chips above the list.
- Paging is cursor based: a "Load more" button at the end, never page numbers.
- Selection with checkboxes only where a bulk action exists.
- A table must fit its card at 1024px beside the sidebar. When it doesn't, the less needed
  columns show only from 1280px and their values move to the meta line under the title (D-174:
  Invoices drops Due date and Total, Payments drops Method and Reference).

### Forms

- Labels above fields, 13px; helper text below in meta style; required fields marked with
  "(required)" in the label, not an asterisk alone.
- Inputs 40px, 8px radius, `--border-strong` border, `--brand` focus ring.
- Errors: the field border and message in `--danger`, from the API's `error.fields` (keys are
  dotted paths such as `students.0.classIds.0`).
- Save buttons stay enabled; a save in progress shows a spinner. A 409 `stale_data` shows "Someone
  else changed this. Reload to see their change." with a Reload button.
- Money inputs show the org's currency symbol and take decimals; they send minor units.

### Banners

Full-width under the top bar, soft background with a matching icon, one line of text, an action
button and a close button where it can be dismissed.

| Case                                                               | Style   | Dismissable  |
| ------------------------------------------------------------------ | ------- | ------------ |
| Trial ends in N days (`trialing`, from `trialEndsAt`)              | warning | yes, per day |
| Read-only: trial ended, suspended or cancelled (`canWrite: false`) | danger  | no           |
| Payment problem (`past_due`)                                       | warning | no           |
| Offline                                                            | neutral | no           |

The trial countdown is for the owner and branch managers only. The read-only and payment
banners show to everyone, since saving fails for every role. The offline banner shows while the
browser reports no connection: "You're offline. Nothing can be loaded or saved until you're back
online." (D-185).

### Feedback

- **Toasts** bottom right (bottom centre on phones, above the tab bar) for completed actions, 4s, with Undo where
  the API allows it. A toast can carry one action button ("Download receipt" after "Payment of
  $120.00 recorded for the Perera family"); one with a button stays 8s, so there's time to
  reach it (D-174). Long toasts wrap on phones.
- **Confirm dialogs** for destructive actions, naming what happens ("Void this invoice for the
  Perera family? Its enrolments can then be invoiced again."). Irreversible ones (erase a family) need the name
  typed to confirm.
- **Empty states**: an icon, one sentence and the next action ("No classes yet. Add your first
  class.").
- **Loading**: skeletons in the shape of the content, never a full-page spinner after first load.
- **Errors**: a 402 `plan_limit` opens an upgrade prompt; a 402 `subscription_required` points to
  the read-only banner; a 503 `unavailable` says which service isn't set up ("PDFs aren't
  available yet: print the page instead").
- **Jobs** (invoice runs, imports, exports, promotion): a progress card that polls
  `GET /jobs/{id}` and shows the result when done.

---

## 7. Content and formatting

- Every user-facing string goes through `t('key')` with one English catalog (D-015). No string
  is built by joining translated fragments.
- Money: integer minor units from the API, shown with `formatMoney` from `packages/shared` in
  the org's currency and locale ("$450.00"). Totals right aligned, tabular numbers.
- Dates in the org's date format, times in the org's timezone; relative times ("12 min ago")
  only for activity.
- Names: family name for families ("Perera family"), first and last name for people.
- Sentence case for everything, including buttons and headings.

---

## 8. Accessibility

- WCAG 2.2 AA: contrast, keyboard access to everything, visible focus, logical heading order.
- Touch targets at least 44 × 44px on phones.
- Status never by colour alone; icons have labels for screen readers.
- Forms announce errors and move focus to the first one.
- Respect reduced motion and the system text size.

---

## 9. Home dashboard

The first screen, as designed. What each part reads:

| Part                                                                   | API                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting, org name, user                                               | `GET /me`, the org from the shell                                                                                                                                                       |
| Trial or read-only banner                                              | `GET /billing/subscription` (owner); `org.status`, `trialEndsAt` for others                                                                                                             |
| Total owing, overdue (with count), received this month, draft invoices | `GET /reports/dashboard` → `money` (left out for teachers and front desk: hide the cards)                                                                                               |
| Today's lessons                                                        | `GET /sessions?from=<today>&to=<today>` (class, room, teacher, times, cancelled, moved)                                                                                                 |
| Whether each lesson is marked                                          | `GET /sessions` → each session's `attendance` (marks by status, all 0 until marked; staff only, D-168)                                                                                  |
| Needs attention                                                        | `GET /reports/dashboard` → `today.absenceNotices`, `makeupCreditsAvailable`, `money.overdueInvoices`; also `unmarkedLessons` (last 14 days). "Oldest is 18 days overdue" isn't returned |
| Quick actions                                                          | Static, filtered by the role's permissions                                                                                                                                              |
| Recent activity                                                        | **No endpoint yet.** `GET /audit-log` is owner only; other roles need a new feed, or leave the panel out for them                                                                       |

Built in TUI-125 (D-179). Changes from the Figma source:

- Front desk, who doesn't see money, gets the centre's counts (families, students, classes,
  lessons today) in place of the money cards.
- Recent activity is left out until there is a feed endpoint; Quick actions sit under today's
  lessons instead. "Send message" waits for the messages screen.
- A centre with no classes yet gets "Getting started" above the panels.
- "Send message" describes **email or portal**: SMS and WhatsApp are paid add-ons, not in the
  base app.
- On phones the stat cards are a 2 × 2 grid and "+ New" is an icon button, so nothing is cut off.
- Text is never below 12px.

---

## 10. Building it

Settled when TUI-23 was built (D-158):

- **Tailwind CSS** with the tokens in §2 as CSS variables mapped into the Tailwind theme, so
  class names read `bg-brand`, `text-muted`, `border-border`.
- **shadcn/ui** (Radix underneath) isn't added. Own primitives cover the screens so far: the
  dialog is the browser's `<dialog>` (focus trap and Escape built in; a bottom sheet on phones),
  plus a 6-digit code input, toasts (with an optional action) and a menu that opens from any
  trigger (the row "…" menu is one), with optional item icons (D-174). Radix comes in when a popover, combobox
  or the `⌘K` search needs it.
- **Lucide** icons; **Inter** self-hosted with the app (no Google Fonts call).
- Components live in `apps/web/src/components/ui/` (primitives) and
  `apps/web/src/components/` (app components such as `StatCard`, `LessonRow`, `StatusBadge`).
- **Sign-in and sign-up** are Clerk's own components, themed with these tokens, inside the app's
  auth layout: the teal brand panel beside the form (D-160).
- **Built so far** (D-161): the desktop sidebar of §5 (logo, org switcher, nav by role, user
  footer), a top bar with a drawer below 1024px, and the banners of §6 for trial, read-only and
  past due. Not yet: the bell (TUI-40).
- **Phone and tablet** (D-185): the tablet icon rail with its drawer, the phone tab bar for
  every role, the offline banner, and an installable app (manifest with PNG and maskable icons,
  Apple touch icon, white theme colour to match the top bar). No service worker yet: offline
  use waits for offline attendance (v1.1).
- **Top-bar search** (D-164): built without Radix. A command palette over the page, full screen on
  phones, opened from the top bar or with Ctrl/⌘ K. The top bar shows on desktop too for roles
  that can search (staff with `people:read`).
- **+ New** (D-174): the top-bar menu of §5 (Family, Class, Payment, Announcement by role) and toast actions,
  first "Download receipt". The bell is still to come.
- **Families & students** (D-164), from the Figma Make people design: the list with families and
  students tabs, the family page, the student page and the Add family dialog. Dialogs take a
  `wide` size (640px) for forms with sections, and focus their first field when they open.
  The student page's Make-up credits card lists each available credit with Book and each
  booked make-up still to come with Cancel; Book opens a dialog of lessons to pick from (D-184).
- **Settings › Theme** (D-165), from the owner's Figma Make design, owner only: a radio grid of
  the 12 themes (D-166: the 4 light ones last) (a mini app mock-up on each, a check on the chosen one), a live preview of the
  staff app, parent portal, invoices and emails that recolours as you pick, and Cancel/Save with
  an unsaved-changes note. On phones: 2 columns of tiles, only the staff-app preview, and a
  sticky full-width Save bar.
- **Classes and attendance** (D-169), from the owner's Figma Make design: the classes list, the
  Add/edit class dialog, the class page (Lessons, Schedule and Students tabs, with Enrolled,
  Lessons and Next lesson cards: 2 + 1 on phones), the enrol, withdraw and move dialogs, and
  the attendance sheet, a page of its own per lesson with a sticky Save. Changes from the
  source are in D-169. The list filters are a shared `FilterSelect`, used by Families & students
  too.
- **Timetable** (D-176), from the owner's Figma Make design: Day, Week and Month calendars
  with View by (branch, room, teacher, student) and filters kept in the URL. Lesson blocks take
  the class colour with one flag (Cancelled, Clash, Moved, Marked or Not marked), overlapping
  lessons share a day in lanes, holidays are hatched, and a clash banner counts room and teacher
  clashes. A lesson opens in the shared dialog (not the design's floating popover), with Move
  lesson and Cancel lesson. On phones: a Filters sheet, Today and ‹ › beside it, a 7-day strip
  and the day's lessons as rows. Drag-and-drop waits for v1.1 (TUI-52).
- **Teacher Today** (D-177), from the owner's Figma Make design (Teacher home): a teacher's
  Home. A next lesson card (on now, next today, else next this week) with "Take attendance" on
  the day, today's lessons with their marking state, Needs attention (earlier lessons not marked,
  absences reported this week) and This week (hidden on phones). Quick attendance is the
  attendance sheet in the shared wide dialog (a bottom sheet on phones); the lesson page's sheet
  and it share one implementation, now with homework for the class. Rows keep the sheet's status
  buttons rather than the design's segmented control.
- **Settings › Branches & rooms** (D-178), from the owner's Figma Make design: a card per
  branch (address, room and class counts) with its rooms as rows (seats, class count), add and
  edit dialogs for branches and rooms, and delete dialogs that list what still uses the item,
  with Delete off. Only the owner changes anything; other staff get a read-only notice and no
  menus. Single-tutor mode hides Add branch with a muted note.
- **Messages** (D-183), from the owner's Figma Make design, for staff with `messages:read`:
  Sent (kind chips for the owner; each message with its audience, channels, recipient count,
  date and sender, then a detail dialog with delivery tiles and the recipients by email status),
  the New announcement dialog (template, audience cards with chips, subject, message, channels,
  then a confirm step), and for the owner Templates and Automatic (the automatic-message
  switches, reminder days and hour, reply-to). Teachers write to their own classes.
- **Settings › Terms & holidays** (D-181), from the owner's Figma Make design: a year switcher,
  the academic year card with a timeline of its terms, holidays and today, the year's terms
  (weeks, classes, Finished / Now · Week n of m / Upcoming, Run invoices on the next term) and
  its holidays by month (all branches or one). Add/edit dialogs for years and terms check
  overlaps as the dates change; Add holiday lists the lessons it will remove. Only the owner
  changes anything; other staff get a read-only notice.
- **Parent portal** (D-180), from the owner's Figma Make design: Home (next lesson, Report an
  absence, the children, latest homework, family balance), a week Timetable by day with child
  chips and a lesson sheet (homework, the teacher's note, report absence for it), the Report an
  absence sheet with which lessons it covers, Invoices (owing and overdue, each invoice with
  its lines and PDF, how to pay with the family reference), Messages to read, and More
  (profile, family, sign out). Same paths as staff (`timetable`, `invoices`) plus `messages`
  and `more`.
- **Settings › Courses** (D-170), from the owner's Figma Make design, for roles that change
  classes: tabs Courses (grouped by grade level, with classes, lesson length and price),
  Subjects and Grade levels (moved with up and down buttons), the Add/edit course dialog (also
  opened from Add class), a small name dialog for subjects and grade levels, and delete dialogs
  that say what still uses the item, with Delete off.
- **Billing** (D-172), from the owner's Figma Make design, for staff with `billing:read`: the
  invoices list (status chips, filters, money stat cards for the owner and branch managers,
  issuing many drafts at once), the invoice page (lines grouped by student, actions by status,
  a sticky action bar on phones), the Run invoices dialog with job progress and a "Left off"
  list, the Record payment dialog (shared across invoices oldest first) and the payments list.
  An invoice is titled by family and period, with its number (D-173). PDFs and receipts open in
  a new tab. Stat cards gained tone tints and the confirm dialog a primary variant.
- **Settings › Pricing** (D-175), built straight to this design system without a Figma design
  (the owner's choice, 2026-10-27), for staff with `billing:read`: tabs Prices (grouped into
  every class, courses and classes), Discounts and Tax rates, card lists in the style of
  Settings › Courses with a one-line explainer above; add and edit dialogs per tab, and a
  searchable checkbox list (`PickList`) for choosing students, families or courses. On phones
  each row puts its value under the name in a two-column grid, so long names aren't cut short.
- **Profile page** (D-161), from the Figma Make profile design: a section menu on the left on
  wide screens, chips and stacked sections on phones. Changes from the source: badges and small
  text stay at 12px (§3), and two-step verification is left out until MFA is available (TUI-80).
- Further screens are designed in the same Figma Make file, starting each prompt with: "Keep the
  exact design system, colours, typography, spacing, sidebar and components from the Home
  dashboard. Reuse existing components before creating new ones."
