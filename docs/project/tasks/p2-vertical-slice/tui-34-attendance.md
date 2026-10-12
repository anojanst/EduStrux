---
id: TUI-34
title: 'Attendance: mark a session'
status: done
phase: P2
module: attendance
priority: P0
size: M
endpoints:
  - GET|PUT /sessions/{id}/attendance
branch: task/tui-34-attendance
pr:
---

# TUI-34 Attendance: mark a session

One-tap on phone. Statuses present/absent/late/excused.

Built: `GET /sessions/{sessionId}/attendance` returns the session's roster, one record per
student whose active enrolment covers its date, with a `status` that is null until they are
marked. `PUT` marks one student, some or the whole class and leaves the rest as they are;
`status: null` clears a mark. A session can be marked from its own day on, and not once it is
cancelled. Teachers mark the classes they teach, parents read their own children's records, and
each request writes one audit row with the statuses that changed.

Decisions: D-070 (marking opens on the session's day), D-071 (marking merges), D-072 (who is on
the roster, and the response), D-073 (who reaches attendance), D-074 (cross-branch children are
marked by name: an assumption for the owner to confirm), D-075 (routes, table, audit row, in-use
checks).
