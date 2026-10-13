import { ATTENDANCE_STATUSES } from '@edustrux/shared';
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
