import { auditLog, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Context } from 'hono';
import type { AppEnv } from '../env';

/**
 * Everything a repository needs to touch org data. Repositories are the only code
 * allowed to query D1, and every repository function takes one of these.
 */
export type OrgCtx = {
  db: Db;
  orgId: string;
  actorUserId: string | null;
};

export function orgCtx(c: Context<AppEnv>): OrgCtx {
  return { db: c.var.db, orgId: c.var.membership.orgId, actorUserId: c.var.user.id };
}

type OrgTable = SQLiteTable & { orgId: SQLiteColumn; deletedAt: SQLiteColumn };

/** `org_id = ? AND deleted_at IS NULL AND ...conds`: use in every org-scoped query. */
export function inOrg(ctx: OrgCtx, table: OrgTable, ...conds: (SQL | undefined)[]) {
  return and(eq(table.orgId, ctx.orgId), isNull(table.deletedAt), ...conds);
}

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

export function auditInsert(ctx: OrgCtx, entry: AuditEntry) {
  return ctx.db.insert(auditLog).values({
    id: newId('audit'),
    orgId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/**
 * Runs the writes and their audit-log row as one D1 batch (all or nothing).
 * Batch results come back as [audit, ...statements].
 */
export function writeWithAudit(ctx: OrgCtx, statements: BatchItem<'sqlite'>[], audit: AuditEntry) {
  const items: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    auditInsert(ctx, audit),
    ...statements,
  ];
  return ctx.db.batch(items);
}
