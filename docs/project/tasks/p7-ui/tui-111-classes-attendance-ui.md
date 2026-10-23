---
id: TUI-111
title: 'Classes & attendance UI: classes list, add class, class page, enrol, attendance sheet'
status: done
phase: P7
module: web
priority: P0
size: L
endpoints:
  - GET /api/v1/orgs/{orgId}/teachers
branch: task/tui-111-classes-attendance-ui
pr: 57
---

# TUI-111 Classes & attendance UI: classes list, add class, class page, enrol, attendance sheet

Split from TUI-40 (staff UI vertical slice): the classes area and marking attendance, built to the
owner's Figma Make design (https://finch-coal-95289917.figma.site/, Classes screens).

- Classes list (term, branch, teacher and course filters, search, enrolled out of capacity)
- Add and edit class: course, name, capacity, term or ongoing dates, branch, room, teacher, weekly
  schedule, with the clash check
- Class page: enrolled, lessons this term and next lesson; Students, Lessons and Schedule tabs;
  enrol, withdraw and transfer a student; cancel or restore a lesson; delete the class
- Lesson attendance sheet: present, late, absent or excused per student, mark all present,
  absence notices from parents, mobile first for teachers
- Teachers see their own classes read only and mark attendance

API additions (owner decision 2026-10-23): classes and lessons carry `teacherName` and
`roomName`, classes carry `enrolledCount`, lessons carry their attendance counts, and
`GET /teachers` lists who can teach (id and name) for anyone who can write classes.

The teacher's phone "Today" view stays in TUI-57.

Decisions: D-166 (teacher and room names, GET /teachers), D-167 (places taken, lesson marks),
D-168 (what the classes and attendance screens show, and what waits).
