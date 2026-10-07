import { newId, type Job, type Role } from '@edustrux/shared';
import type { JobMessage } from '../../background/messages';
import type { OrgCtx } from '../../db/scope';
import { notFound } from '../../lib/errors';
import * as repo from './repository';

export function toJob(row: repo.JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    attempts: row.attempts,
    result: row.result ?? null,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Records a job and queues it. Routes return `202 { jobId }` with the id this returns.
 * `type` must have a handler in JOB_HANDLERS, or the job fails when it runs.
 */
export async function startJob(
  ctx: OrgCtx,
  queue: Queue<JobMessage>,
  type: string,
  input?: unknown,
): Promise<string> {
  const jobId = newId('job');
  await repo.insertJob(ctx, { id: jobId, type, input });
  try {
    await queue.send({ orgId: ctx.orgId, jobId });
  } catch (err) {
    // Without this the job would sit in queued forever.
    await repo.failJob(ctx, jobId, 'Could not queue the job. Please try again.');
    throw err;
  }
  return jobId;
}

/**
 * Only the person who started a job and the org owner can see it: a job's result or error can
 * hold data the role otherwise couldn't read. Anyone else gets the same 404 as for a missing id.
 */
export async function getJob(ctx: OrgCtx, role: Role, jobId: string): Promise<Job> {
  const row = await repo.findJob(ctx, jobId);
  if (!row || (role !== 'owner' && row.createdByUserId !== ctx.actorUserId)) {
    throw notFound('Job');
  }
  return toJob(row);
}
