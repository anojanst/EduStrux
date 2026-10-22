import { z } from '../zod';
import { Timestamp } from './common';

// Files in R2 with short-lived signed links (TUI-61).

/** What a file is for: a spreadsheet to import, an export to download, or an attachment. */
export const FILE_PURPOSES = ['import', 'export', 'attachment'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** The largest file that can be uploaded: 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const UPLOAD_TYPES = ['text/csv', 'application/pdf', 'image/png', 'image/jpeg'] as const;

export const CreateUpload = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^/\\\0]+$/, 'A file name, no folders')
      .openapi({ example: 'students.csv' }),
    contentType: z.enum(UPLOAD_TYPES),
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES).openapi({
      description: 'The file’s size in bytes. The upload may not be bigger.',
    }),
    purpose: z.enum(FILE_PURPOSES).exclude(['export']).default('import'),
  })
  .openapi('CreateUpload');
export type CreateUpload = z.infer<typeof CreateUpload>;

export const StoredFile = z
  .object({
    id: z.string().openapi({ example: 'fil_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    purpose: z.enum(FILE_PURPOSES),
    filename: z.string(),
    contentType: z.string(),
    size: z.number().int().nullable().openapi({ description: 'null until uploaded.' }),
    status: z.enum(['pending', 'uploaded']),
    expiresAt: Timestamp.nullable().openapi({
      description: 'When it is removed. null = kept.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('StoredFile');
export type StoredFile = z.infer<typeof StoredFile>;

export const UploadLink = z
  .object({
    file: StoredFile,
    uploadUrl: z.string().openapi({
      description: '`PUT` the file’s bytes here, with its Content-Type, before `expiresAt`.',
    }),
    expiresAt: Timestamp,
  })
  .openapi('UploadLink');

export const FileWithLink = StoredFile.extend({
  downloadUrl: z.string().nullable().openapi({
    description: 'A link to the file, good for 5 minutes. null until it is uploaded.',
  }),
  downloadExpiresAt: Timestamp.nullable(),
}).openapi('FileWithLink');
