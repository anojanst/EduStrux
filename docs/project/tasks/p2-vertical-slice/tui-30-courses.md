---
id: TUI-30
title: Courses (subject × grade)
status: done
phase: P2
module: curriculum
priority: P0
size: S
endpoints:
  - GET|POST /courses
  - PATCH|DELETE /courses/{id}
branch: task/tui-30-courses
pr:
---

# TUI-30 Courses (subject × grade)

Optional curriculum, teaching medium, default price, duration.

Built: `GET /courses` takes `?subjectId` and `?gradeLevelId`; the path parameter is `{courseId}`.
Deleting a grade level or subject is now refused (422) while a course uses it.

Decisions: D-041 (owner and branch staff write; unique on subject + grade + curriculum + medium;
duration is lesson length in minutes), D-042 (every role reads, an assumption for the owner to
confirm), D-043 (fields, default price, filters, in-use checks).
