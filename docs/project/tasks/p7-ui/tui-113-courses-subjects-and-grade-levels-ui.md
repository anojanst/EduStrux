---
id: TUI-113
title: Courses, subjects and grade levels UI
status: done
phase: P7
module: curriculum
priority: P0
size: M
endpoints: []
branch: task/tui-113-courses-ui
pr: 58
---

# TUI-113 Courses, subjects and grade levels UI

Settings › Courses, from the owner's Figma Make design: tabs for courses (grouped by grade level,
with class count, lesson length and default price), subjects and grade levels (reordered with up
and down buttons); add, edit and delete for each, with delete dialogs that say what still uses
the item. Add class opens the same Add course dialog from "+ New course…".

API: `GET /courses` gains `classCount` per course (a correlated subquery, no extra trip).

Decisions: D-170 (and D-169's Add class course select updated).

Not built from the design: dragging grade levels (buttons instead), and the student count per
grade level, which the API doesn't have.
