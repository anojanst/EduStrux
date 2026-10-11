import { auditLog, type Db } from '@edustrux/db';
import { newId, type Role, type Scope } from '@edustrux/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
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

/**
 * Who is asking, and how far the route's permission reaches for them. Services turn this into
 * filters: `branch` keeps to `branchIds` (null = every branch), `own` to the caller's own records.
 */
export type Access = {
  scope: Scope;
  role: Role;
  membershipId: string;
  branchIds: string[] | null;
};

export function access(c: Context<AppEnv>): Access {
  const { id, role, branchIds } = c.var.membership;
  return { scope: c.var.scope, role, membershipId: id, branchIds };
}

type OrgTable = SQLiteTable & { orgId: SQLiteColumn; deletedAt: SQLiteColumn };

/** `column IN (ids)`, with the ids bound as one JSON value so a long list stays under D1's limit. */
export function inIds(column: SQLiteColumn, ids: string[]) {
  return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}

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
