import { z } from '../zod';
import { Timestamp } from './common';

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);

export const Job = z
  .object({
    id: z.string(),
    type: z.string(),
    status: JobStatus,
    progress: z.number().min(0).max(100),
    result: z.unknown().nullable(),
    error: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Job');

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
