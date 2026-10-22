import { z } from '../zod';
import { Timestamp } from './common';

// A full data export (TUI-78): everything the org has, as one JSON file.

export const DataExport = z
  .object({
    id: z.string().openapi({ example: 'exp_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    status: z.enum(['queued', 'running', 'done', 'failed']),
    jobId: z.string().nullable(),
    counts: z.record(z.string(), z.number().int()).nullable().openapi({
      description: 'Rows per table, once done.',
    }),
    downloadUrl: z.string().nullable().openapi({
      description: 'A link to the JSON file, good for 5 minutes, once done.',
    }),
    expiresAt: Timestamp.nullable().openapi({ description: 'When the file is removed.' }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('DataExport');
export type DataExport = z.infer<typeof DataExport>;
