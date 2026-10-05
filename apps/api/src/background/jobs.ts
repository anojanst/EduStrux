import { jobs, type Db } from '@edustrux/db';
import { and, eq } from 'drizzle-orm';
import type { Bindings } from '../env';
import type { JobMessage } from './messages';

export type JobContext = {
  db: Db;
  env: Bindings;
  orgId: string;
  jobId: string;
  input: unknown;
  setProgress: (percent: number) => Promise<void>;
};

/** Job type → handler. Modules register theirs here (term invoices, imports, promotion, …). */
export const JOB_HANDLERS: Record<string, (ctx: JobContext) => Promise<unknown>> = {};

export async function runJob(db: Db, env: Bindings, message: JobMessage) {
  const where = and(eq(jobs.id, message.jobId), eq(jobs.orgId, message.orgId));
  const job = await db.select().from(jobs).where(where).get();
  if (!job || job.status === 'succeeded') return;

  const handler = JOB_HANDLERS[job.type];
  if (!handler) {
    await db
      .update(jobs)
      .set({ status: 'failed', error: `No handler for job type "${job.type}"` })
      .where(where);
    return;
  }

  await db.update(jobs).set({ status: 'running' }).where(where);
  try {
    const result = await handler({
      db,
      env,
      orgId: job.orgId,
      jobId: job.id,
      input: job.input,
      setProgress: async (percent) => {
        await db
          .update(jobs)
          .set({ progress: Math.round(percent) })
          .where(where);
      },
    });
    await db
      .update(jobs)
      .set({ status: 'succeeded', progress: 100, result: result ?? null })
      .where(where);
  } catch (err) {
    await db
      .update(jobs)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(where);
    throw err; // let the queue retry
  }
}
