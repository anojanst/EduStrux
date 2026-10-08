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
