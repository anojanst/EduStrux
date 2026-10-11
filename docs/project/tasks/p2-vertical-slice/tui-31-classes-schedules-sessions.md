---
id: TUI-31
title: Classes + weekly schedule + session generation
status: done
phase: P2
module: classes
priority: P0
size: L
endpoints:
  - GET|POST /classes
  - GET|PATCH|DELETE /classes/{id}
  - PUT /classes/{id}/schedule
  - GET /sessions
  - GET /sessions/{id}
branch: task/tui-31-classes-schedules-sessions
pr: 16
---

# TUI-31 Classes + weekly schedule + session generation

Recurrence rule → dated sessions, holidays skipped, local date/time + org tz (DST-safe, D-016). PUT schedule regenerates future sessions only.

Built: path parameters are `{classId}` and `{sessionId}`. `GET /sessions` needs `from` and `to`
and filters by branch, room, teacher, grade level and class; the `?student` filter and parents'
reach wait for enrolments (TUI-33). A course, term, room or branch can't be deleted while a class
uses it, and adding a holiday removes the upcoming sessions it closes.

Decisions: D-044 (open-ended classes generate 13 weeks ahead), D-045 (one audit row per schedule
change), D-046 (a later holiday removes the sessions it closes), D-047 (upcoming sessions only,
by diff, stored in local time), D-048 (who reaches classes and sessions), D-049 (class rules),
D-050 (schedule slots, lists, in-use checks).
