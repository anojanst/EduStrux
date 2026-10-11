import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// Names are unique per org (rooms: per branch), ignoring case and deleted rows.
// SQLite's lower() folds ASCII letters only, which is enough for setup names.

export const branches = sqliteTable(
  'branches',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    address: text('address'),
  },
  (t) => [
    uniqueIndex('branches_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const rooms = sqliteTable(
  'rooms',
  {
    ...orgColumns(),
    branchId: text('branch_id').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity'),
  },
  (t) => [
    index('rooms_org_branch_idx').on(t.orgId, t.branchId),
    uniqueIndex('rooms_org_branch_name_uq')
      .on(t.orgId, t.branchId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const gradeLevels = sqliteTable(
  'grade_levels',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    // Position in the org's grade order (1 = first). Not unique: PUT /grade-levels/order
    // rewrites every row in one batch, and gaps after a delete are fine.
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('grade_levels_org_sort_idx').on(t.orgId, t.sortOrder),
    uniqueIndex('grade_levels_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const subjects = sqliteTable(
  'subjects',
  {
    ...orgColumns(),
    name: text('name').notNull(),
  },
  (t) => [
    uniqueIndex('subjects_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// A course is a subject taught at a grade level, optionally narrowed by curriculum and teaching
// medium. That combination is unique per org, ignoring case and deleted rows; a missing
// curriculum or medium counts as its own value.
export const courses = sqliteTable(
  'courses',
  {
    ...orgColumns(),
    subjectId: text('subject_id').notNull(),
    gradeLevelId: text('grade_level_id').notNull(),
    curriculum: text('curriculum'),
    teachingMedium: text('teaching_medium'),
    // Minor units plus currency. Both null = no default price.
    defaultPriceAmount: integer('default_price_amount'),
    defaultPriceCurrency: text('default_price_currency'),
    // Default lesson length.
    durationMinutes: integer('duration_minutes'),
  },
  (t) => [
    index('courses_org_grade_idx').on(t.orgId, t.gradeLevelId),
    // NULLs are distinct in a unique index, so a missing value is indexed as ''. Written with
    // CASE, not coalesce(): drizzle-kit splits an index expression at its commas.
    uniqueIndex('courses_org_subject_grade_curriculum_medium_uq')
      .on(
        t.orgId,
        t.subjectId,
        t.gradeLevelId,
        sql`(case when ${t.curriculum} is null then '' else lower(${t.curriculum}) end)`,
        sql`(case when ${t.teachingMedium} is null then '' else lower(${t.teachingMedium}) end)`,
      )
      .where(sql`${t.deletedAt} is null`),
  ],
);

// Calendar. Dates are local `YYYY-MM-DD` text, which sorts and compares correctly as text.

export const academicYears = sqliteTable(
  'academic_years',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
  },
  (t) => [
    index('academic_years_org_start_idx').on(t.orgId, t.startDate),
    uniqueIndex('academic_years_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const terms = sqliteTable(
  'terms',
  {
    ...orgColumns(),
    academicYearId: text('academic_year_id').notNull(),
    name: text('name').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
  },
  (t) => [
    index('terms_org_start_idx').on(t.orgId, t.startDate),
    index('terms_org_year_idx').on(t.orgId, t.academicYearId),
    uniqueIndex('terms_org_year_name_uq')
      .on(t.orgId, t.academicYearId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const holidays = sqliteTable(
  'holidays',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    // null = the whole org is closed; otherwise only this branch.
    branchId: text('branch_id'),
  },
  (t) => [index('holidays_org_start_idx').on(t.orgId, t.startDate)],
);

export const taxRates = sqliteTable(
  'tax_rates',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    // Basis points (hundredths of a percent): 15% = 1500. Integers, like money's minor units.
    rateBps: integer('rate_bps').notNull(),
    // true = prices already include this tax.
    inclusive: integer('inclusive', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    uniqueIndex('tax_rates_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);
