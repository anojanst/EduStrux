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
type Cond = SQL | undefined;

/**
 * A query for ids that is never sent on its own: `inIds` writes it into the statement it
 * filters, so it costs no database trip (D-104). Made by `idsFrom`, which puts the org in it.
 */
class IdSelect {
  constructor(
    readonly ctx: OrgCtx,
    readonly table: OrgTable,
    readonly column: SQLiteColumn,
    readonly conds: Cond[],
    /** A big share of the org's rows: see `wide`. */
    readonly wide = false,
    /** Only the first rows in this order: see `firstIds`. */
    readonly first?: { limit: number; orderBy: SQL[] },
  ) {}
}
export type IdQuery = IdSelect;

/**
 * Ids to filter by: the ids themselves, or a query for them. A repository that takes ids takes
 * either and filters with `inIds`, so its code reads the same for both.
 */
export type Ids = string[] | IdQuery;

/**
 * The ids in `column` of the rows `inOrg(ctx, table, ...conds)` finds, as a query to filter
 * another table by: `inIds(students.id, idsFrom(ctx, enrolments, enrolments.studentId, …))`.
 * One built from another composes them: a teacher's students are the active enrolments in the
 * teacher's classes.
 */
export function idsFrom(
  ctx: OrgCtx,
  table: OrgTable,
  column: SQLiteColumn,
  ...conds: Cond[]
): IdQuery {
  if (column.table !== table) throw new Error(`${column.name} is not a column of that table`);
  return new IdSelect(ctx, table, column, conds);
}

/**
 * Marks ids as a big share of the org's rows: everything in some branches. A statement never
 * goes to them. It finds its rows some other way, such as a page in its own order, and looks
 * each row up in the query. Unmarked ids are taken to be few (a parent's children, a teacher's
 * classes), and a statement goes straight to them.
 */
export function wide(ids: IdQuery): IdQuery {
  return new IdSelect(ids.ctx, ids.table, ids.column, ids.conds, true, ids.first);
}

/**
 * Only the first `limit` of the ids, in this order: the ids on one page of a list, so what the
 * page shows of other tables can be read in the same stage as the page.
 */
export function firstIds(ids: IdQuery, limit: number, ...orderBy: [SQL, ...SQL[]]): IdQuery {
  return new IdSelect(ids.ctx, ids.table, ids.column, ids.conds, false, { limit, orderBy });
}

/** `SELECT [org,] column FROM table WHERE …`, with the query's own org and conditions. */
function selectIds(query: IdQuery, pairedWith?: string): SQL {
  const { ctx, table, column, conds, first } = query;
  const what = pairedWith === undefined ? sql`${column}` : sql`${pairedWith}, ${column}`;
  const rows = sql`select ${what} from ${table} where ${inOrg(ctx, table, ...conds)}`;
  if (!first) return rows;
  return sql`${rows} order by ${sql.join(first.orderBy, sql`, `)} limit ${first.limit}`;
}

/**
 * Whether the value in `column` is among the query's ids, for a row found some other way.
 * Few ids are read once and kept. Wide ones are looked up for each row, by that row's value, so
 * the statement never reads all of them. That look-up names the outer table, which it can't do
 * when the query is on the same table, so then the ids are read once as well.
 */
function among(column: SQLiteColumn, query: IdQuery): SQL {
  const { ctx, table, conds } = query;
  if (!query.wide || query.first || table === column.table) {
    return sql`${column} in (${selectIds(query)})`;
  }
  const found = and(eq(table.orgId, ctx.orgId), isNull(table.deletedAt), eq(query.column, column));
  return sql`exists (select 1 from ${table} where ${and(found, ...conds)})`;
}

/**
 * What `inIds` has made, so `inOrg` can tell ids from any other condition. Real ids are kept as
 * the JSON they are bound as.
 */
const idLists = new WeakMap<SQL, { column: SQLiteColumn; ids: string | IdQuery }>();

/**
 * `column IN (ids)`. Real ids are bound as one JSON value, so a long list stays under D1's
 * limit. A query for ids is written in as a subquery (D-104).
 * Given straight to `inOrg` it is a lookup by those ids, which `inOrg` makes SQLite go to.
 * Inside `and()`, `or()` or a subquery of its own it only narrows what something else finds,
 * and so do ids marked `wide`, wherever they are.
 */
export function inIds(column: SQLiteColumn, ids: Ids) {
  const source = Array.isArray(ids) ? JSON.stringify(ids) : ids;
  const list =
    typeof source === 'string'
      ? sql`${column} in (select value from json_each(${source}))`
      : among(column, source);
  idLists.set(list, { column, ids: source });
  return list;
}

/**
 * `org_id = ? AND deleted_at IS NULL AND ...conds`: use in every org-scoped query.
 *
 * With ids from `inIds` among the conditions, the org is written to fit the index the lookup
 * should use (D-100). Production has no table statistics, and without them SQLite would sooner
 * read every row the org has than go to the ids.
 * - Primary keys: `+org_id = ?`. The key alone finds the row, so the org is only checked, and
 *   the `+` keeps SQLite from choosing an index by it.
 * - Ids in any other column: `(org_id, column) IN (SELECT ?, id …)`, matched as a pair, for the
 *   index on `(org_id, column)`.
 * The ids can be real or a query (D-104). The first ones on one of the table's own columns that
 * aren't `wide` are the lookup; any others only narrow it.
 */
export function inOrg(ctx: OrgCtx, table: OrgTable, ...conds: Cond[]): SQL | undefined {
  const live = isNull(table.deletedAt);
  const lookup = conds.find((cond) => {
    const list = cond && idLists.get(cond);
    if (!list || list.column.table !== table) return false;
    return typeof list.ids === 'string' || !list.ids.wide;
  });
  const list = lookup && idLists.get(lookup);
  if (!list) return and(eq(table.orgId, ctx.orgId), live, ...conds);
  if (list.column.primary) return and(sql`+${table.orgId} = ${ctx.orgId}`, live, ...conds);
  const pairs =
    typeof list.ids === 'string'
      ? sql`select ${ctx.orgId}, value from json_each(${list.ids})`
      : selectIds(list.ids, ctx.orgId);
  return and(
    sql`(${table.orgId}, ${list.column}) in (${pairs})`,
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
