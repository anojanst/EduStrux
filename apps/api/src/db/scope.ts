import { auditLog, type Db } from '@edustrux/db';
import { newId, type Role, type Scope } from '@edustrux/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Context } from 'hono';
import type { AppEnv, OrgRow } from '../env';

/**
 * Everything a repository needs to touch org data. Repositories are the only code
 * allowed to query D1, and every repository function takes one of these.
 */
export type OrgCtx = {
  db: Db;
  orgId: string;
  actorUserId: string | null;
  /**
   * The org, when the request's middleware has already loaded it (D-099). Don't read it from
   * here: call `getOrg(ctx)` in the orgs service, which uses it and reads D1 only where there
   * is no request (queue jobs, cron).
   */
  org?: OrgRow;
};

export function orgCtx(c: Context<AppEnv>): OrgCtx {
  return {
    db: c.var.db,
    orgId: c.var.membership.orgId,
    actorUserId: c.var.user.id,
    org: c.var.org,
  };
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

/** The id lists `inIds` has made, so `inOrg` can tell one from any other condition. */
const idLists = new WeakMap<SQL, { column: SQLiteColumn; json: string }>();

/**
 * `column IN (ids)`, with the ids bound as one JSON value so a long list stays under D1's limit.
 * Given straight to `inOrg` it is a lookup by those ids, which `inOrg` makes SQLite go to.
 * Inside `and()`, `or()` or a subquery of its own it only narrows what something else finds.
 */
export function inIds(column: SQLiteColumn, ids: string[]) {
  const json = JSON.stringify(ids);
  const list = sql`${column} in (select value from json_each(${json}))`;
  idLists.set(list, { column, json });
  return list;
}

/**
 * `org_id = ? AND deleted_at IS NULL AND ...conds`: use in every org-scoped query.
 *
 * With an id list from `inIds` among the conditions, the org is written to fit the index the
 * lookup should use (D-100). Production has no table statistics, and without them SQLite would
 * sooner read every row the org has than go to a list of ids.
 * - A list of primary keys: `+org_id = ?`. The key alone finds the row, so the org is only
 *   checked, and the `+` keeps SQLite from choosing an index by it.
 * - A list on any other column: `(org_id, column) IN (SELECT ?, value …)`, matched as a pair, for
 *   the index on `(org_id, column)`.
 * The first id list on one of the table's own columns is the lookup; any other only narrows it.
 */
export function inOrg(ctx: OrgCtx, table: OrgTable, ...conds: (SQL | undefined)[]) {
  const live = isNull(table.deletedAt);
  const lookup = conds.find((cond) => cond && idLists.get(cond)?.column.table === table);
  const ids = lookup && idLists.get(lookup);
  if (!ids) return and(eq(table.orgId, ctx.orgId), live, ...conds);
  if (ids.column.primary) return and(sql`+${table.orgId} = ${ctx.orgId}`, live, ...conds);
  return and(
    sql`(${table.orgId}, ${ids.column}) in (select ${ctx.orgId}, value from json_each(${ids.json}))`,
    live,
    ...conds.filter((cond) => cond !== lookup),
  );
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
