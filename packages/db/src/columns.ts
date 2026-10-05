import { text } from 'drizzle-orm/sqlite-core';

// Timestamps are ISO 8601 UTC strings: sortable as text and returned to clients unchanged.
export const now = () => new Date().toISOString();

export const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  deletedAt: text('deleted_at'),
};

/** Columns every org-owned table carries: id, org_id, created_at, updated_at, deleted_at. */
export const orgColumns = () => ({
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  ...timestamps,
});
