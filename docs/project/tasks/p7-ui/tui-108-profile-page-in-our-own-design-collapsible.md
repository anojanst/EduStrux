---
id: TUI-108
title: Profile page in our own design, collapsible sidebar and full-width pages
status: done
phase: P7
module: web
priority: P1
size: M
endpoints: []
branch: task/tui-108-profile-page-sidebar
pr:
---

# TUI-108 Profile page in our own design, collapsible sidebar and full-width pages

Follow-up to TUI-23, asked for by the owner on 2026-10-22 after trying the first web screens.

- The profile page (`/o/:orgSlug/profile`, from the sidebar's user footer), built to the Figma
  Make profile design on Clerk's browser API: photo and name, email addresses with code
  verification, setting or changing a password, signed-in devices, deleting the account (not for
  owners), and each centre's role. Sensitive changes ask "Confirm it's you" in our own dialog.
  Two-step verification waits for TUI-80.
- The sidebar collapses to a 72px icon rail, remembered per browser.
- Pages fill the width beside the sidebar; the profile page too, as a trial.

Decisions: D-161 (profile), ui-design §5 and §10.
