---
id: TUI-23
title: 'Web app shell: routing, Clerk sign-in, TanStack Query, mobile-first layout'
status: done
phase: P7
module: web
priority: P0
size: M
endpoints: []
branch: task/tui-23-web-shell-auth
pr: 52
---

# TUI-23 Web app shell: routing, Clerk sign-in, TanStack Query, mobile-first layout

Staff app + parent portal in one React app. PWA manifest. D-015: set up i18n structure: every user-facing string via t('key') with a single en catalog (English only).

Built in `apps/web` with registration and sign-in for every user type: centre owners (sign-up,
then onboarding creates the org), and staff and parents through their invite link
(`/invitations/{token}`, with the new `GET /api/v1/invitations/{token}` preview). Settings › Team
sends staff invites. Decisions D-158 to D-162. Left for later: the top-bar search, "+ New" and
bell, the tablet icon rail and phone bottom tabs (TUI-40, TUI-84), and serving the build from the
Worker (TUI-107).
