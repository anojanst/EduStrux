import { jobs, type Db } from '@edustrux/db';
import { and, eq } from 'drizzle-orm';
import type { OrgCtx } from '../db/scope';
import type { Bindings } from '../env';
import type { JobMessage } from './messages';

/** Must match `max_retries` for the jobs consumer in wrangler.jsonc. */
export const JOBS_MAX_RETRIES = 3;

/**
 * What a handler gets. It is an `OrgCtx` acting as the user who started the job, so it can be
 * passed straight to repositories and `writeWithAudit`.
 */
export type JobContext = OrgCtx & {
  env: Bindings;
  jobId: string;
  input: unknown;
  setProgress: (percent: number) => Promise<void>;
};

/**
 * Job type → handler. Modules register theirs here (term invoices, imports, promotion, …).
 *
 * A handler that throws is retried from the start (up to JOBS_MAX_RETRIES times), and the queue
 * may deliver a message more than once. So handlers must be idempotent: running one twice must
 * not, for example, issue a second invoice for the same enrolment and period.
 */
export const JOB_HANDLERS: Record<string, (ctx: JobContext) => Promise<unknown>> = {};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs one delivery of a job. `attempt` is the queue's delivery count, starting at 1.
 *
 * Status only moves forward: queued → running → succeeded, or → failed on the last attempt.
 * A failed attempt with retries left goes back to queued (keeping the error) and rethrows so the
 * queue retries it. Succeeded and failed jobs are final, so a redelivered message does nothing.
 */
export async function runJob(db: Db, env: Bindings, message: JobMessage, attempt: number) {
  const where = and(eq(jobs.id, message.jobId), eq(jobs.orgId, message.orgId));
  const job = await db.select().from(jobs).where(where).get();
  if (!job || job.status === 'succeeded' || job.status === 'failed') return;

  const handler = JOB_HANDLERS[job.type];
  if (!handler) {
    // Retrying can't help, so fail now.
    await db
      .update(jobs)
      .set({ status: 'failed', attempts: attempt, error: `No handler for job type "${job.type}"` })
      .where(where);
    return;
  }

  await db.update(jobs).set({ status: 'running', attempts: attempt, progress: 0 }).where(where);
  try {
    const result = await handler({
      db,
      orgId: job.orgId,
      actorUserId: job.createdByUserId,
      env,
      jobId: job.id,
      input: job.input,
      setProgress: async (percent) => {
        await db
          .update(jobs)
          .set({ progress: Math.min(99, Math.max(0, Math.round(percent))) })
          .where(where);
      },
    });
    await db
      .update(jobs)
      .set({ status: 'succeeded', progress: 100, result: result ?? null, error: null })
      .where(where);
  } catch (err) {
    const lastAttempt = attempt > JOBS_MAX_RETRIES;
    await db
      .update(jobs)
      .set({ status: lastAttempt ? 'failed' : 'queued', error: errorText(err) })
      .where(where);
    if (lastAttempt) {
      console.error(`job ${job.id} (${job.type}) failed after ${attempt} attempts`, err);
      return; // final: ack the message rather than relying on the queue to drop it
    }
    throw err; // the consumer retries with backoff
  }
}
