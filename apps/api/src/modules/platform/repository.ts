import { auditLog, files, imports, jobs, type Db } from '@edustrux/db';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
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

// ── Files (TUI-61) ──────────────────────────────────────────────────────────

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;

export async function insertFile(ctx: OrgCtx, row: NewFileRow & { id: string }) {
  const [, inserted] = await writeWithAudit(ctx, [ctx.db.insert(files).values(row).returning()], {
    action: 'file.created',
    entityType: 'file',
    entityId: row.id,
    after: { purpose: row.purpose, filename: row.filename, contentType: row.contentType },
  });
  return (inserted as FileRow[])[0]!;
}

export function findFile(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(files)
    .where(inOrg(ctx, files, eq(files.id, id)))
    .get();
}

/**
 * A file by id alone, whatever its org: for the signed links, where the signature is the proof
 * and there is no signed-in member. Nothing else may read a file without its org.
 */
export function findFileBySignedLink(db: Db, id: string) {
  return db
    .select()
    .from(files)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))
    .get();
}

export async function markUploaded(db: Db, id: string, size: number) {
  await db
    .update(files)
    .set({ status: 'uploaded', size, updatedAt: new Date().toISOString() })
    .where(eq(files.id, id));
}

/** The files past their expiry, any org's, for the daily clean-up (TUI-68). */
export function expiredFiles(db: Db, now: string, limit: number) {
  return db
    .select({ id: files.id, r2Key: files.r2Key })
    .from(files)
    .where(and(isNull(files.deletedAt), lt(files.expiresAt, now)))
    .limit(limit);
}

export async function softDeleteFiles(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .update(files)
    .set({ deletedAt: new Date().toISOString() })
    .where(sql`${files.id} in (select value from json_each(${JSON.stringify(ids)}))`);
}

// ── Imports (TUI-60) ────────────────────────────────────────────────────────

export type ImportRow = typeof imports.$inferSelect;
export type NewImportRow = typeof imports.$inferInsert;

export async function insertImport(ctx: OrgCtx, row: NewImportRow & { id: string }) {
  const [, inserted] = await writeWithAudit(ctx, [ctx.db.insert(imports).values(row).returning()], {
    action: 'import.created',
    entityType: 'import',
    entityId: row.id,
    after: { fileId: row.fileId, rowCount: row.rowCount },
  });
  return (inserted as ImportRow[])[0]!;
}

export function findImport(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(imports)
    .where(inOrg(ctx, imports, eq(imports.id, id)))
    .get();
}

/** Changes an import; with `from`, only while its status is one of those. */
export async function updateImport(
  ctx: OrgCtx,
  id: string,
  change: Partial<NewImportRow>,
  from?: ImportRow['status'][],
) {
  const rows = await ctx.db
    .update(imports)
    .set({ ...change, updatedAt: new Date().toISOString() })
    .where(
      inOrg(ctx, imports, eq(imports.id, id), from ? inArray(imports.status, from) : undefined),
    )
    .returning();
  return rows[0];
}
