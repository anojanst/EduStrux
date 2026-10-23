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

- **Org themes (D-165).** The six brand and sidebar tokens above (`--brand`, `--brand-hover`,
  `--brand-soft`, `--sidebar`, `--sidebar-raised`, `--sidebar-text`) follow the org's colour
  theme; the values in the table are the default, **teal**. The others are ocean, indigo,
  violet, berry, forest, amber and graphite, defined once in the shared theme catalog and used by
  the web, PDFs and emails. Every other token stays the same in every theme. Inside an org the
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
    Messages, Reports, Settings, and Theme for owners (D-165). Items are 40px high, icon + label; the active item is a white
    pill with `--brand` text. A count badge (`--danger`, white text) sits at the right edge.
    Items the role can't use are left out.
  - **User footer**: avatar, name and role; opens profile and sign out.
- **Top bar**, 64px, white with a bottom border:
  - Global search: full-width field with a search icon and a `⌘K` hint, finding families,
    students and guardians (`GET /search`).
  - **+ New**: the primary button with a menu (family, student, enrolment, payment, message),
    showing only what the role may create.
  - Notifications bell with a dot when there's something new.
- **Banner slot** under the top bar, full width (see §6, Banners).
- **Content**: the full width beside the sidebar, edge to edge, with 32px padding (16px on
  phones). The profile page too, beside its section menu (tried on 2026-10-22; revert to a
  720px column if wide forms read badly).
- **Collapsing:** a button at the top of the sidebar turns it into a 72px icon rail (logo mark,
  org avatar, nav icons, profile avatar and sign out), with each label shown beside its icon on
  hover and keyboard focus. The choice is remembered on that browser.

### Tablet (640–1023px)

The sidebar collapses to a 72px icon rail; labels show on hover and in a slide-out drawer from a
menu button.

### Phone (< 640px)

- Top bar: menu button (opens the sidebar as a drawer), search, and **+ New** as a 40px icon
  button. Nothing may overflow the screen width.
- **Bottom tab bar** with the four most used areas for the role. Staff: Home, Timetable,
  Families, Invoices, More. Teacher: Today, Timetable, Messages, More. Parent: Home, Timetable,
  Invoices, Messages, More.
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
("$450.00 · INV-1042"), relative time on the right.

### Quick action tile

Icon tile, title and a one-line description, chevron; two columns on desktop, one on phones.

### Lists and tables

- Header row in label style on `--canvas`; rows 52px, divided by `--border`; hover `--canvas`.
- Sorting by clicking headers that support it; filters as chips above the list.
- Paging is cursor based: a "Load more" button at the end, never page numbers.
- Selection with checkboxes only where a bulk action exists.

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
banners show to everyone, since saving fails for every role.

### Feedback

- **Toasts** bottom right (bottom centre on phones) for completed actions, 4s, with Undo where
  the API allows it.
- **Confirm dialogs** for destructive actions, naming what happens ("Void invoice INV-1042? Its
  enrolments can then be invoiced again."). Irreversible ones (erase a family) need the name
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
| Whether each lesson is marked                                          | **Not in the API yet.** The dashboard gives only a count (`today.marked`). Per-lesson state needs a field on sessions, or one `GET /sessions/{id}/attendance` per lesson                |
| Needs attention                                                        | `GET /reports/dashboard` → `today.absenceNotices`, `makeupCreditsAvailable`, `money.overdueInvoices`; also `unmarkedLessons` (last 14 days). "Oldest is 18 days overdue" isn't returned |
| Quick actions                                                          | Static, filtered by the role's permissions                                                                                                                                              |
| Recent activity                                                        | **No endpoint yet.** `GET /audit-log` is owner only; other roles need a new feed, or leave the panel out for them                                                                       |

Changes from the Figma source:

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
  plus a 6-digit code input, toasts and a row "…" menu. Radix comes in when a popover, combobox
  or the `⌘K` search needs it.
- **Lucide** icons; **Inter** self-hosted with the app (no Google Fonts call).
- Components live in `apps/web/src/components/ui/` (primitives) and
  `apps/web/src/components/` (app components such as `StatCard`, `LessonRow`, `StatusBadge`).
- **Sign-in and sign-up** are Clerk's own components, themed with these tokens, inside the app's
  auth layout: the teal brand panel beside the form (D-160).
- **Built so far** (D-161): the desktop sidebar of §5 (logo, org switcher, nav by role, user
  footer), a top bar with a drawer below 1024px, and the banners of §6 for trial, read-only and
  past due. Not yet: top-bar search, "+ New", the bell, the tablet icon rail and the phone tab
  bar (TUI-40, TUI-84).
- **Top-bar search** (D-164): built without Radix. A command palette over the page, full screen on
  phones, opened from the top bar or with Ctrl/⌘ K. The top bar shows on desktop too for roles
  that can search (staff with `people:read`). "+ New" and the bell are still to come.
- **Families & students** (D-164), from the Figma Make people design: the list with families and
  students tabs, the family page, the student page and the Add family dialog. Dialogs take a
  `wide` size (640px) for forms with sections, and focus their first field when they open.
- **Settings › Theme** (D-165), from the owner's Figma Make design, owner only: a radio grid of
  the 8 themes (a mini app mock-up on each, a check on the chosen one), a live preview of the
  staff app, parent portal, invoices and emails that recolours as you pick, and Cancel/Save with
  an unsaved-changes note. On phones: 2 columns of tiles, only the staff-app preview, and a
  sticky full-width Save bar.
- **Profile page** (D-161), from the Figma Make profile design: a section menu on the left on
  wide screens, chips and stacked sections on phones. Changes from the source: badges and small
  text stay at 12px (§3), and two-step verification is left out until MFA is available (TUI-80).
- Further screens are designed in the same Figma Make file, starting each prompt with: "Keep the
  exact design system, colours, typography, spacing, sidebar and components from the Home
  dashboard. Reuse existing components before creating new ones."
