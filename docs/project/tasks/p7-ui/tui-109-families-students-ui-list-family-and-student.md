---
id: TUI-109
title: 'Families & students UI: list, family and student pages, add family, portal invites, search'
status: done
phase: P7
module: web
priority: P0
size: L
endpoints: []
branch: task/tui-109-families-students-ui
pr:
---

# TUI-109 Families & students UI: list, family and student pages, add family, portal invites, search

Split from TUI-40 (staff UI vertical slice): the people area, built to the owner's Figma Make design (https://finch-coal-95289917.figma.site/, Families & students screens).

- Families & students list (families and students tabs, branch and grade filters, search, load more)
- Family page: students, guardians (edit, billing contact, remove, parent portal invite), balance and recent payments for roles that read billing, address; edit, delete, erase
- Student page: classes, upcoming lessons, make-up credits, grade history, consents, notes for staff
- Add family: family, first guardian and students in one form, with the duplicate check
- Global search (Ctrl/⌘K) for families, students and guardians
- Teachers read only; billing cards only for roles with billing:read

Enrol, transfer and withdraw come with the classes screens.

Decisions: D-163 (students carry `familyName`), D-164 (what the screens show, and what waits for
the API or the classes screens).
