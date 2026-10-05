import { auditLog, jobs } from '@edustrux/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { inOrg, type OrgCtx } from '../../db/scope';

export function findJob(ctx: OrgCtx, jobId: string) {
  return ctx.db
    .select()
    .from(jobs)
    .where(inOrg(ctx, jobs, eq(jobs.id, jobId)))
    .get();
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
