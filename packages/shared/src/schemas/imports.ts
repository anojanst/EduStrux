import { z } from '../zod';
import { Timestamp } from './common';

// Spreadsheet import with manual column mapping (TUI-60). AI mapping is a paid add-on.

/**
 * `mapping`: the columns are being matched to fields. `ready`: the mapping is set and every row
 * passed the check. `committing`, then `done` or `failed`.
 */
export const IMPORT_STATUSES = ['mapping', 'ready', 'committing', 'done', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** The most rows one import takes. */
export const MAX_IMPORT_ROWS = 1000;

/** What a column can be. One row is one student, with their family and one guardian. */
export const IMPORT_FIELDS = [
  'studentFirstName',
  'studentLastName',
  'grade',
  'familyName',
  'branch',
  'guardianFirstName',
  'guardianLastName',
  'guardianEmail',
  'guardianPhone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const CreateImport = z
  .object({
    fileId: z.string().openapi({ description: 'An uploaded CSV file (`POST /files/upload-url`).' }),
  })
  .openapi('CreateImport');

export const ImportProblem = z
  .object({ row: z.number().int(), field: z.string(), message: z.string() })
  .openapi('ImportProblem');

export const Import = z
  .object({
    id: z.string().openapi({ example: 'imp_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    fileId: z.string(),
    status: z.enum(IMPORT_STATUSES),
    headers: z.array(z.string()),
    sampleRows: z.array(z.array(z.string())).openapi({ description: 'The first 5 rows.' }),
    rowCount: z.number().int(),
    mapping: z.record(z.string(), z.enum(IMPORT_FIELDS)).nullable(),
    defaults: z
      .object({ branchId: z.string().optional() })
      .nullable()
      .openapi({ description: 'The home branch for rows with no `branch` column.' }),
    problems: z.array(ImportProblem).openapi({
      description: 'What the last check found, the first 100. Commit needs none.',
    }),
    jobId: z.string().nullable(),
    result: z
      .object({
        families: z.number().int(),
        guardians: z.number().int(),
        students: z.number().int(),
      })
      .nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Import');
export type Import = z.infer<typeof Import>;

export const MapImport = z
  .object({
    updatedAt: Timestamp,
    mapping: z.record(z.string(), z.enum(IMPORT_FIELDS)).openapi({
      description:
        'Column header → field. Columns left out are ignored. `studentFirstName` and ' +
        '`studentLastName` are required; each field once.',
      example: {
        First: 'studentFirstName',
        Surname: 'studentLastName',
        'Parent email': 'guardianEmail',
      },
    }),
    defaults: z.object({ branchId: z.string().optional() }).default({}),
  })
  .openapi('MapImport');
export type MapImport = z.infer<typeof MapImport>;
