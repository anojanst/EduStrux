import { SESSION_STATUSES } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// A class is one group of a course: who teaches it and where. Its weekly slots are in
// class_schedules, and the dated lessons those produce are in sessions.
export const classes = sqliteTable(
  'classes',
  {
    ...orgColumns(),
    courseId: text('course_id').notNull(),
    // Copied from the course, which keeps its grade level for life, so classes and sessions can
    // be filtered by grade without reading the curriculum tables.
    gradeLevelId: text('grade_level_id').notNull(),
    // null = open-ended from start_date, billed monthly.
    termId: text('term_id'),
    branchId: text('branch_id').notNull(),
    roomId: text('room_id'),
    // The teacher's membership id.
    teacherMembershipId: text('teacher_membership_id'),
    name: text('name').notNull(),
    capacity: integer('capacity'),
    // Local dates. In a term they narrow the term's own dates and are optional; without a term
    // start_date is required and a null end_date means "until further notice".
    startDate: text('start_date'),
    endDate: text('end_date'),
  },
  (t) => [
    // GET /classes pages in id order: through the first index, or through the one for the filter
    // it is given (D-101).
    uniqueIndex('classes_org_id_uq').on(t.orgId, t.id),
    index('classes_org_branch_idx').on(t.orgId, t.branchId, t.id),
    index('classes_org_course_idx').on(t.orgId, t.courseId, t.id),
    index('classes_org_teacher_idx').on(t.orgId, t.teacherMembershipId, t.id),
    index('classes_org_term_idx').on(t.orgId, t.termId, t.id),
    // A name is unique among a course's classes in the same term and branch, ignoring case and
    // deleted rows. "No term" is indexed as '' (NULLs are distinct in a unique index), written
    // with CASE because drizzle-kit splits an index expression at its commas.
    uniqueIndex('classes_org_course_term_branch_name_uq')
      .on(
        t.orgId,
        t.courseId,
        sql`(case when ${t.termId} is null then '' else ${t.termId} end)`,
        t.branchId,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.deletedAt} is null`),
  ],
);

// One row per weekly slot. PUT /classes/{classId}/schedule replaces a class's whole set.
export const classSchedules = sqliteTable(
  'class_schedules',
  {
    ...orgColumns(),
    classId: text('class_id').notNull(),
    // ISO weekday: 1 = Monday … 7 = Sunday.
    weekday: integer('weekday').notNull(),
    // Local `HH:MM` in the org's timezone.
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [index('class_schedules_org_class_idx').on(t.orgId, t.classId)],
);

// One dated lesson. The date and times are local to the org's timezone, so a 4 pm class stays
// at 4 pm across daylight-saving changes; the UTC instants are worked out when read.
export const sessions = sqliteTable(
  'sessions',
  {
    ...orgColumns(),
    classId: text('class_id').notNull(),
    // Copied from the class when the session is generated, so changing the class's room or
    // teacher later doesn't rewrite sessions that have already taken place.
    roomId: text('room_id'),
    teacherMembershipId: text('teacher_membership_id'),
    date: text('date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    status: text('status', { enum: SESSION_STATUSES }).notNull().default('scheduled'),
    // Where a lesson moved by hand was first scheduled (TUI-49). The generator treats that slot
    // as taken by it, and never moves or removes it. Both null for a lesson that hasn't moved.
    originalDate: text('original_date'),
    originalStartTime: text('original_start_time'),
  },
  (t) => [
    index('sessions_org_date_idx').on(t.orgId, t.date, t.startTime, t.id),
    // Also stops two runs of the generator from creating the same session twice.
    uniqueIndex('sessions_org_class_date_start_uq')
      .on(t.orgId, t.classId, t.date, t.startTime)
      .where(sql`${t.deletedAt} is null`),
  ],
);
