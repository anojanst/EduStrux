import { CONTACT_CHANNELS } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// Names are kept as typed and again normalised (lower-case, accents stripped), for alphabetical
// lists now and for prefix search and duplicate warnings later.

// A family is the household that is contacted and billed: its guardians and its students.
export const families = sqliteTable(
  'families',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    // The family's home branch. Staff limited to some branches reach only those branches' families.
    branchId: text('branch_id').notNull(),
    address: text('address'),
    // The guardian invoices are addressed to: the first one added, until another is chosen.
    billingGuardianId: text('billing_guardian_id'),
  },
  (t) => [
    index('families_org_name_idx').on(t.orgId, t.nameNorm, t.id),
    index('families_org_branch_idx').on(t.orgId, t.branchId),
  ],
);

// A contact person for a family: a parent, or anyone else to call in an emergency.
export const guardians = sqliteTable(
  'guardians',
  {
    ...orgColumns(),
    familyId: text('family_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    firstNameNorm: text('first_name_norm').notNull(),
    lastNameNorm: text('last_name_norm').notNull(),
    relationship: text('relationship'),
    // Stored lower-case.
    email: text('email'),
    phone: text('phone'),
    preferredChannel: text('preferred_channel', { enum: CONTACT_CHANNELS })
      .notNull()
      .default('email'),
    // A stored preference; nothing acts on it yet.
    language: text('language'),
    emergencyContact: integer('emergency_contact', { mode: 'boolean' }).notNull().default(true),
    // The `parent` membership this guardian signs in with. null until they accept an invite.
    membershipId: text('membership_id'),
  },
  (t) => [
    index('guardians_org_family_idx').on(t.orgId, t.familyId),
    index('guardians_org_membership_idx').on(t.orgId, t.membershipId),
  ],
);

export const students = sqliteTable(
  'students',
  {
    ...orgColumns(),
    familyId: text('family_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    firstNameNorm: text('first_name_norm').notNull(),
    lastNameNorm: text('last_name_norm').notNull(),
    // Local `YYYY-MM-DD`.
    dateOfBirth: text('date_of_birth'),
    notes: text('notes'),
  },
  (t) => [
    index('students_org_name_idx').on(t.orgId, t.lastNameNorm, t.firstNameNorm, t.id),
    index('students_org_family_idx').on(t.orgId, t.familyId),
  ],
);

// A student's grade level in one academic year: at most one row per student and year.
export const studentGrades = sqliteTable(
  'student_grades',
  {
    ...orgColumns(),
    studentId: text('student_id').notNull(),
    academicYearId: text('academic_year_id').notNull(),
    gradeLevelId: text('grade_level_id').notNull(),
  },
  (t) => [
    uniqueIndex('student_grades_org_student_year_uq')
      .on(t.orgId, t.studentId, t.academicYearId)
      .where(sql`${t.deletedAt} is null`),
    index('student_grades_org_year_grade_idx').on(t.orgId, t.academicYearId, t.gradeLevelId),
  ],
);
