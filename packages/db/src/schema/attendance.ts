import {
  ABSENCE_NOTICE_SOURCES,
  ATTENDANCE_STATUSES,
  MAKEUP_CREDIT_STATUSES,
} from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

// The org's make-up rules (TUI-55). At most one row per org; none means make-ups are off.
export const makeupPolicies = sqliteTable(
  'makeup_policies',
  {
    ...orgColumns(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    // Which marks earn a credit.
    creditForExcused: integer('credit_for_excused', { mode: 'boolean' }).notNull().default(true),
    creditForAbsent: integer('credit_for_absent', { mode: 'boolean' }).notNull().default(false),
    // Only when an absence notice covering the lesson was given before it started.
    requireNotice: integer('require_notice', { mode: 'boolean' }).notNull().default(true),
    // A credit lapses this many days after the missed lesson. null = never.
    expiryDays: integer('expiry_days'),
    // A make-up must be a lesson of the same course as the one missed.
    sameCourseOnly: integer('same_course_only', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    uniqueIndex('makeup_policies_org_uq')
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// A missed lesson a student may make up. Earned when attendance is marked under the policy, and
// taken back if the mark changes while it is still unused.
export const makeupCredits = sqliteTable(
  'makeup_credits',
  {
    ...orgColumns(),
    studentId: text('student_id').notNull(),
    // The lesson missed, its class and course, and its date.
    sessionId: text('session_id').notNull(),
    classId: text('class_id').notNull(),
    courseId: text('course_id').notNull(),
    missedOn: text('missed_on').notNull(),
    // Local date, the last day it can be used. null = never lapses.
    expiresOn: text('expires_on'),
    status: text('status', { enum: MAKEUP_CREDIT_STATUSES }).notNull().default('available'),
    // The booking that used it.
    bookingId: text('booking_id'),
  },
  (t) => [
    uniqueIndex('makeup_credits_org_id_uq').on(t.orgId, t.id),
    // One credit per student and missed lesson.
    uniqueIndex('makeup_credits_org_session_student_uq')
      .on(t.orgId, t.sessionId, t.studentId)
      .where(sql`${t.deletedAt} is null`),
    index('makeup_credits_org_student_idx').on(t.orgId, t.studentId, t.id),
    index('makeup_credits_org_status_idx').on(t.orgId, t.status, t.expiresOn),
  ],
);

// A student booked into another lesson to make up a missed one, using a credit.
export const makeupBookings = sqliteTable(
  'makeup_bookings',
  {
    ...orgColumns(),
    creditId: text('credit_id').notNull(),
    studentId: text('student_id').notNull(),
    // The lesson the student comes to.
    sessionId: text('session_id').notNull(),
  },
  (t) => [
    uniqueIndex('makeup_bookings_org_id_uq').on(t.orgId, t.id),
    // A student is booked into a lesson once. Also the index a lesson's roster reads.
    uniqueIndex('makeup_bookings_org_session_student_uq')
      .on(t.orgId, t.sessionId, t.studentId)
      .where(sql`${t.deletedAt} is null`),
    // A credit is used once: two bookings of it at the same moment can't both be written.
    uniqueIndex('makeup_bookings_org_credit_uq')
      .on(t.orgId, t.creditId)
      .where(sql`${t.deletedAt} is null`),
  ],
);
