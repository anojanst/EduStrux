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
    // Thousandths of a percent, so rates like 8.875% stay exact: 15% = 15000.
    rateMilliPercent: integer('rate_milli_percent').notNull(),
    // true = prices already include this tax.
    inclusive: integer('inclusive', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    uniqueIndex('tax_rates_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);
