---
id: TUI-33
title: 'Enrolments: enrol a student in a class'
status: done
phase: P2
module: enrolment
priority: P0
size: M
endpoints:
  - GET|POST /enrolments
branch: task/tui-33-enrolments
pr:
---

# TUI-33 Enrolments: enrol a student in a class

Capacity check, start/end, price override. Transfer/withdraw comes in P3.

Built: `GET /enrolments` filters by `?studentId` and `?classId`, and each enrolment carries the
student's name and the class's name, course and branch. To enrol, the caller must reach both the
student and the class. A class with a capacity refuses once its places are taken, and a student
holds one active enrolment per class. Teachers now reach the students in their classes and
parents their children's classes. `GET /sessions` takes `?studentId`. A class or a student with
enrolments can't be deleted.

Decisions: D-058 (cross-branch enrolment: reach both), D-059 (who reaches enrolments), D-060
(teacher and parent reach through enrolments), D-061 (names carried on an enrolment), D-062
(dates, price override, status, duplicates, capacity), D-063 (list and routes, in-use checks, the
sessions student filter).
