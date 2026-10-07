import { z } from '../zod';
import { Timestamp } from './common';

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);

export const Job = z
  .object({
    id: z.string(),
    type: z.string(),
    status: JobStatus,
    progress: z.number().min(0).max(100),
    attempts: z.number().int().min(0).openapi({
      description: 'Times the job has been tried. A failed try is retried up to 3 times.',
    }),
    result: z.unknown().nullable(),
    error: z
      .string()
      .nullable()
      .openapi({
        description:
          'The last error. While status is queued and attempts > 0, a retry is pending; ' +
          'status becomes failed only when the last try fails.',
      }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Job');
export type Job = z.infer<typeof Job>;

export const AuditEntry = z
  .object({
    id: z.string(),
    actorUserId: z.string().nullable(),
    action: z.string().openapi({ example: 'org.updated' }),
    entityType: z.string(),
    entityId: z.string(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    createdAt: Timestamp,
  })
  .openapi('AuditEntry');
