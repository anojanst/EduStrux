---
id: TUI-115
title: Drop the six non-crucial personal fields
status: todo
phase: P6
module: people
priority: P0
size: M
endpoints:
  - POST /families
  - PATCH /families/{id}
  - PATCH /guardians/{id}
  - POST /students
  - PATCH /students/{id}
  - POST /absence-notices
branch:
pr:
---

# TUI-115 Drop the six non-crucial personal fields

D-171. Remove what the product can work without:

| Field                                | Replaced by                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `students.date_of_birth`             | nothing; the grade level places the student              |
| `students.notes`                     | nothing; lesson notes stay for tutor-to-parent notes     |
| `families.address`                   | nothing; invoices and PDFs drop the address line         |
| `guardians.relationship`             | nothing                                                  |
| `guardians.language`                 | nothing (nothing read it)                                |
| `absence_notices.reason` (free text) | a fixed `reason`: `sick`, `holiday` or `other`, optional |

- Generated migration drops the columns (values already stored are lost) and maps the absence
  reason to `other` where one was given.
- Shared Zod schemas, API responses, the public form, the portal, CSV import and export, the
  family erase (D-155) and the web screens all lose the fields.
- Tests: the fields no longer appear in responses or `/api/openapi.json`; the absence reason
  accepts the three values only (400 otherwise).
