---
id: TUI-79
title: 'Privacy controls: consents, retention, delete a family'
status: todo
phase: P6
module: platform
priority: P0
size: M
endpoints: []
branch:
pr:
---

# TUI-79 Privacy controls: consents, retention, delete a family

## To revisit: audit log growth

Raised 2026-10-07 and deferred by the owner. `audit_log` lives in the one shared D1 database
(10 GB limit) and grows with every write: about 1 KB per row, since updates store the whole
previous row in `before`. Rough estimate: about 165 MB/year at the ~26-centre target, but about
6.4 GB/year at 1,000 centres.

Options. 2 is decided for session generation (D-045); 1 and 3 are still deferred:

1. Store only the changed fields in `before`/`after` (one change in `writeWithAudit`). Not
   decided.
2. Write one audit row per bulk action (an attendance session, an invoice run), not one per
   student. **Decided by the owner on 2026-10-11 for session generation (D-045, TUI-31):** a
   schedule change writes one `class.schedule_set` row with the weekly slots before and after
   and the counts of sessions added and removed, not one row per session. Attendance marking
   (TUI-34) and invoice runs (TUI-37) should follow the same rule unless the owner says
   otherwise.
3. Retention: a monthly job archives audit rows older than N months to R2 (compressed, per org
   per month), deletes them from D1, and includes the archives in the full data export (TUI-78).
   Not decided.

Avoid a separate D1 database for the audit log: a change and its audit row are written in one
D1 batch, and a batch can't span two databases. Decide 1 before attendance marking and invoice
runs are built.
