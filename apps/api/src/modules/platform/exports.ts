import { newId, type DataExport } from '@edustrux/shared';
import type { JobContext } from '../../background/jobs';
import type { JobMessage } from '../../background/messages';
import type { OrgCtx } from '../../db/scope';
import type { Bindings } from '../../env';
import { notFound } from '../../lib/errors';
import * as orgs from '../orgs/service';
import { getFile, storeFile } from './files';
import * as repo from './repository';
import { startJob } from './service';

// The full data export (TUI-78): everything the org has, every table, as one JSON file the
// owner downloads. A job makes it; the file is kept a week.

/** The job type of an export. */
export const EXPORT = 'exports.make';

const PAGE = 2000;
const KEEP_DAYS = 7;

/** Every row the org has, by table, as one JSON document. */
export async function exportDocument(ctx: OrgCtx) {
  const org = await orgs.getOrg(ctx);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of Object.keys(repo.EXPORTED_TABLES)) {
    const rows: Record<string, unknown>[] = [];
    let after = '';
    for (;;) {
      const page = await repo.exportPage(ctx, table, after, PAGE);
      rows.push(...page);
      if (page.length < PAGE) break;
      after = String(page.at(-1)!.id);
    }
    tables[table] = rows;
  }
  tables.users = await repo.memberUsers(ctx);
  const counts = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length]),
  );
  return {
    json: JSON.stringify({
      format: 'edustrux-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      org,
      tables,
    }),
    counts,
  };
}

/** Starts an export. The owner only (the route's permission). */
export async function startExport(ctx: OrgCtx, queue: Queue<JobMessage>) {
  const id = newId('export');
  await repo.insertExport(ctx, {
    id,
    orgId: ctx.orgId,
    status: 'queued',
    createdByUserId: ctx.actorUserId,
  });
  const jobId = await startJob(ctx, queue, EXPORT, { exportId: id });
  await repo.updateExport(ctx, id, { jobId });
  return { id, jobId };
}

/** The job behind an export. A redelivered one finds it done and does nothing. */
export async function makeExport(ctx: JobContext) {
  const { exportId } = ctx.input as { exportId: string };
  const row = await repo.findExport(ctx, exportId);
  if (!row) throw new Error(`Export ${exportId} not found`);
  if (row.status === 'done') return { exportId, counts: row.counts };
  await repo.updateExport(ctx, exportId, { status: 'running' });
  const { json, counts } = await exportDocument(ctx);
  await ctx.setProgress(80);
  const date = new Date().toISOString().slice(0, 10);
  const file = await storeFile(ctx, ctx.env, {
    filename: `export-${date}.json`,
    contentType: 'application/json',
    body: json,
    expiresAt: new Date(Date.now() + KEEP_DAYS * 86_400_000).toISOString(),
  });
  await repo.updateExport(ctx, exportId, { status: 'done', fileId: file.id, counts });
  return { exportId, counts };
}

export async function getExport(
  ctx: OrgCtx,
  env: Bindings,
  origin: string,
  id: string,
): Promise<DataExport> {
  const row = await repo.findExport(ctx, id);
  if (!row) throw notFound('Export');
  const file =
    row.status === 'done' && row.fileId
      ? await getFile(ctx, env, origin, 'owner', row.fileId).catch(() => null)
      : null;
  return {
    id: row.id,
    status: row.status,
    jobId: row.jobId,
    counts: row.counts ?? null,
    downloadUrl: file?.downloadUrl ?? null,
    expiresAt: file?.expiresAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
