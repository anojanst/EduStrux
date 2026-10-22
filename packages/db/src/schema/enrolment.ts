import { ENQUIRY_STATUSES, ENROLMENT_REQUEST_STATUSES, ENROLMENT_STATUSES } from '@edustrux/shared';
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

// An enquiry from the public form (TUI-47): someone asking about classes. Not a family yet.
export const enquiries = sqliteTable(
  'enquiries',
  {
    ...orgColumns(),
    branchId: text('branch_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    studentName: text('student_name'),
    message: text('message').notNull(),
    status: text('status', { enum: ENQUIRY_STATUSES }).notNull().default('new'),
    // SHA-256 of the sender's IP address, to slow down floods. The address itself isn't kept.
    ipHash: text('ip_hash'),
  },
  (t) => [
    uniqueIndex('enquiries_org_id_uq').on(t.orgId, t.id),
    index('enquiries_org_status_idx').on(t.orgId, t.status, t.id),
    index('enquiries_org_ip_idx').on(t.orgId, t.ipHash, t.createdAt),
  ],
);

// A family asking online to enrol children in classes (TUI-47). Staff approve it, which adds
// the family, guardian, students and enrolments, or reject it.
export const enrolmentRequests = sqliteTable(
  'enrolment_requests',
  {
    ...orgColumns(),
    branchId: text('branch_id'),
    status: text('status', { enum: ENROLMENT_REQUEST_STATUSES }).notNull().default('pending'),
    // `{ firstName, lastName, email, phone }`.
    guardian: text('guardian', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    // `[{ firstName, lastName, dateOfBirth, classIds }]`.
    students: text('students', { mode: 'json' }).$type<Record<string, unknown>[]>().notNull(),
    notes: text('notes'),
    ipHash: text('ip_hash'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: text('decided_at'),
    reason: text('reason'),
    // What approving made: `{ familyId, guardianId, studentIds, enrolmentIds, skipped }`.
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex('enrolment_requests_org_id_uq').on(t.orgId, t.id),
    index('enrolment_requests_org_status_idx').on(t.orgId, t.status, t.id),
    index('enrolment_requests_org_ip_idx').on(t.orgId, t.ipHash, t.createdAt),
  ],
);
