import { FILE_PURPOSES } from '@edustrux/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// A file in R2 under `orgs/{orgId}/files/{id}` (TUI-61). The row is made first, `pending`; the
// upload through a signed link stores the bytes and makes it `uploaded`.
export const files = sqliteTable(
  'files',
  {
    ...orgColumns(),
    purpose: text('purpose', { enum: FILE_PURPOSES }).notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    // The most the upload may be, in bytes, and what it was once uploaded.
    maxSize: integer('max_size').notNull(),
    size: integer('size'),
    r2Key: text('r2_key').notNull(),
    status: text('status', { enum: ['pending', 'uploaded'] })
      .notNull()
      .default('pending'),
    uploadedByUserId: text('uploaded_by_user_id'),
    // When the daily clean-up removes it. null = kept.
    expiresAt: text('expires_at'),
  },
  (t) => [
    uniqueIndex('files_org_id_uq').on(t.orgId, t.id),
    index('files_expires_idx').on(t.expiresAt),
  ],
);
