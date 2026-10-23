---
id: TUI-110
title: 'Org colour themes: preset theme picker for owners, applied across app, portal, PDFs and emails'
status: done
phase: P7
module: web
priority: P1
size: M
endpoints:
  - PATCH /api/v1/orgs/{orgId}
  - GET /api/v1/orgs/{orgId}
branch: task/tui-110-org-themes
pr:
---

# TUI-110 Org colour themes: preset theme picker for owners, applied across app, portal, PDFs and emails

Owner picks a theme from a predefined set instead of a free hex colour (owner decision 2026-10-23). API and UI built together.

- API: replace `orgs.brandColor` (free `#RRGGBB`) with `orgs.theme`, an enum of preset keys (default `teal`, today's look). Theme catalog in `packages/shared`, shared by API and web; every theme passes WCAG AA with white text.
- Applies everywhere: staff app, parent portal, PDFs, emails.
- UI: owner-only theme picker (swatches, live preview) in org settings. The web sets `--brand`, `--brand-hover`, `--brand-soft` from the active org's theme.

Decision: D-165. UI from the owner's Figma Make design (Settings › Theme).
