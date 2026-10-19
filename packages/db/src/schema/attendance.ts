import { ABSENCE_NOTICE_SOURCES, ATTENDANCE_STATUSES } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// One student's mark at one session. A student with no row hasn't been marked; clearing a mark
// soft-deletes its row.
export const attendance = sqliteTable(
  'attendance',
  {
    ...orgColumns(),
    sessionId: text('session_id').notNull(),
    studentId: text('student_id').notNull(),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
  },
  (t) => [
    // A student has at most one mark at a session. Also the index a session's roster reads.
    uniqueIndex('attendance_org_session_student_uq')
      .on(t.orgId, t.sessionId, t.studentId)
      .where(sql`${t.deletedAt} is null`),
    index('attendance_org_student_idx').on(t.orgId, t.studentId),
  ],
);

// A student is away, or was, from one date to another, both included. It flags the student on
// every lesson of theirs in those dates, whichever class or session; it marks nothing.
export const absenceNotices = sqliteTable(
  'absence_notices',
  {
    ...orgColumns(),
    studentId: text('student_id').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    reason: text('reason'),
    /** Who gave it: a parent through the portal, or a member of staff. */
    source: text('source', { enum: ABSENCE_NOTICE_SOURCES }).notNull(),
  },
  (t) => [
    // The list is paged by id (D-101), and a roster looks up its students' notices.
    uniqueIndex('absence_notices_org_id_uq').on(t.orgId, t.id),
    index('absence_notices_org_student_idx').on(t.orgId, t.studentId, t.id),
  ],
);
