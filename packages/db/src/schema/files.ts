import { FILE_PURPOSES, IMPORT_STATUSES } from '@edustrux/shared';
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

// A spreadsheet import (TUI-60): an uploaded CSV, the column mapping staff choose, and what
// committing it made. One row of the sheet is one student, with their family and a guardian.
export const imports = sqliteTable(
  'imports',
  {
    ...orgColumns(),
    fileId: text('file_id').notNull(),
    status: text('status', { enum: IMPORT_STATUSES }).notNull().default('mapping'),
    headers: text('headers', { mode: 'json' }).$type<string[]>().notNull(),
    rowCount: integer('row_count').notNull(),
    // Column header → field, and values for fields no column gives.
    mapping: text('mapping', { mode: 'json' }).$type<Record<string, string>>(),
    defaults: text('defaults', { mode: 'json' }).$type<Record<string, string>>(),
    // The problems the last check found: `[{ row, field, message }]`, the first 100.
    problems: text('problems', { mode: 'json' }).$type<
      { row: number; field: string; message: string }[]
    >(),
    jobId: text('job_id'),
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdByUserId: text('created_by_user_id'),
  },
  (t) => [uniqueIndex('imports_org_id_uq').on(t.orgId, t.id)],
);
