import { auditLog, jobs } from '@edustrux/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type JobRow = typeof jobs.$inferSelect;

export function findJob(ctx: OrgCtx, jobId: string) {
  return ctx.db
    .select()
    .from(jobs)
    .where(inOrg(ctx, jobs, eq(jobs.id, jobId)))
    .get();
}

/** Inserts a queued job started by `ctx.actorUserId`, with its audit row. */
export async function insertJob(ctx: OrgCtx, job: { id: string; type: string; input: unknown }) {
  await writeWithAudit(
    ctx,
    [
      ctx.db.insert(jobs).values({
        id: job.id,
        orgId: ctx.orgId,
        type: job.type,
        input: job.input ?? null,
        createdByUserId: ctx.actorUserId,
      }),
    ],
    {
      action: 'job.started',
      entityType: 'job',
      entityId: job.id,
      after: { type: job.type, input: job.input ?? null },
    },
  );
}

export async function failJob(ctx: OrgCtx, jobId: string, error: string) {
  await ctx.db
    .update(jobs)
    .set({ status: 'failed', error })
    .where(inOrg(ctx, jobs, eq(jobs.id, jobId)));
}

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listAudit(ctx: OrgCtx, limit: number, beforeId?: string) {
  // audit_log is append-only (no deleted_at), so it's scoped by org_id directly.
  return ctx.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), beforeId ? lt(auditLog.id, beforeId) : undefined))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
}
