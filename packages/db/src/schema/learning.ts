import { sql } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// The homework set at a lesson: one text for the whole session. No row means none is set, and
// clearing it soft-deletes its row.
export const lessonHomework = sqliteTable(
  'lesson_homework',
  {
    ...orgColumns(),
    sessionId: text('session_id').notNull(),
    homework: text('homework').notNull(),
  },
  (t) => [
    uniqueIndex('lesson_homework_org_session_uq')
      .on(t.orgId, t.sessionId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// A note on one student at one lesson. No row means no note, and clearing it soft-deletes its row.
export const lessonNotes = sqliteTable(
  'lesson_notes',
  {
    ...orgColumns(),
    sessionId: text('session_id').notNull(),
    studentId: text('student_id').notNull(),
    note: text('note').notNull(),
  },
  (t) => [
    // A student has at most one note at a session. Also the index a session's notes read.
    uniqueIndex('lesson_notes_org_session_student_uq')
      .on(t.orgId, t.sessionId, t.studentId)
      .where(sql`${t.deletedAt} is null`),
    index('lesson_notes_org_student_idx').on(t.orgId, t.studentId),
  ],
);
