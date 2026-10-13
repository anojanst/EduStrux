import { ENROLMENT_STATUSES } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// One student's place in one class, for a span of dates.
export const enrolments = sqliteTable(
  'enrolments',
  {
    ...orgColumns(),
    studentId: text('student_id').notNull(),
    classId: text('class_id').notNull(),
    // Local dates, both included. A null end_date means until the class ends.
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    // Minor units plus currency: what this student pays instead of the usual price. Both null =
    // no override.
    priceOverrideAmount: integer('price_override_amount'),
    priceOverrideCurrency: text('price_override_currency'),
    status: text('status', { enum: ENROLMENT_STATUSES }).notNull().default('active'),
  },
  (t) => [
    // GET /enrolments pages in id order: through the first index, or through the class's or the
    // student's when the list is filtered by one (D-101).
    uniqueIndex('enrolments_org_id_uq').on(t.orgId, t.id),
    index('enrolments_org_class_idx').on(t.orgId, t.classId, t.id),
    index('enrolments_org_student_idx').on(t.orgId, t.studentId, t.id),
    // A student holds at most one active enrolment in a class.
    uniqueIndex('enrolments_org_student_class_active_uq')
      .on(t.orgId, t.studentId, t.classId)
      .where(sql`${t.deletedAt} is null and ${t.status} = 'active'`),
  ],
);
