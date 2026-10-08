import { academicYears, holidays, now, terms } from '@edustrux/db';
import { and, asc, count, eq, gt, gte, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type AcademicYearRow = typeof academicYears.$inferSelect;
export type NewAcademicYearRow = typeof academicYears.$inferInsert;
export type AcademicYearChanges = Partial<
  Pick<NewAcademicYearRow, 'name' | 'startDate' | 'endDate'>
>;
export type TermRow = typeof terms.$inferSelect;
export type NewTermRow = typeof terms.$inferInsert;
export type TermChanges = Partial<Pick<NewTermRow, 'name' | 'startDate' | 'endDate'>>;
export type HolidayRow = typeof holidays.$inferSelect;
export type NewHolidayRow = typeof holidays.$inferInsert;

type DateCursor = { date: string; id: string };
type Dated = { startDate: SQLiteColumn; endDate: SQLiteColumn; id: SQLiteColumn };

/** Rows after the cursor, in (start date, id) order. */
function afterCursor(table: Dated, cursor?: DateCursor) {
  if (!cursor) return undefined;
  return or(
    gt(table.startDate, cursor.date),
    and(eq(table.startDate, cursor.date), gt(table.id, cursor.id)),
  );
}

/** Ranges that share at least one day with [start, end] (both inclusive). */
function overlapping(table: Dated, start: string, end: string) {
  return and(lte(table.startDate, end), gte(table.endDate, start));
}

/** Case-insensitive name match. */
const sameName = (column: SQLiteColumn, name: string) => sql`lower(${column}) = lower(${name})`;

// ── Academic years ──────────────────────────────────────────────────────────

/** In start-date order. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listAcademicYears(ctx: OrgCtx, limit: number, cursor?: DateCursor) {
  return ctx.db
    .select()
    .from(academicYears)
    .where(inOrg(ctx, academicYears, afterCursor(academicYears, cursor)))
    .orderBy(asc(academicYears.startDate), asc(academicYears.id))
    .limit(limit + 1);
}

export function findAcademicYear(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(academicYears)
    .where(inOrg(ctx, academicYears, eq(academicYears.id, id)))
    .get();
}

export async function academicYearNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      inOrg(
        ctx,
        academicYears,
        sameName(academicYears.name, name),
        exceptId ? ne(academicYears.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

/** Another academic year that shares a day with [start, end], if any. */
export function overlappingAcademicYear(
  ctx: OrgCtx,
  start: string,
  end: string,
  exceptId?: string,
) {
  return ctx.db
    .select()
    .from(academicYears)
    .where(
      inOrg(
        ctx,
        academicYears,
        overlapping(academicYears, start, end),
        exceptId ? ne(academicYears.id, exceptId) : undefined,
      ),
    )
    .get();
}

export async function insertAcademicYear(ctx: OrgCtx, year: NewAcademicYearRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(academicYears).values(year)], {
    action: 'academic_year.created',
    entityType: 'academic_year',
    entityId: year.id,
    after: year,
  });
}

export async function updateAcademicYear(
  ctx: OrgCtx,
  before: AcademicYearRow,
  changes: AcademicYearChanges,
) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(academicYears)
        .set(changes)
        .where(inOrg(ctx, academicYears, eq(academicYears.id, before.id))),
    ],
    {
      action: 'academic_year.updated',
      entityType: 'academic_year',
      entityId: before.id,
      before,
      after: changes,
    },
  );
}

// ── Terms ───────────────────────────────────────────────────────────────────

export function listTerms(
  ctx: OrgCtx,
  limit: number,
  cursor?: DateCursor,
  academicYearId?: string,
) {
  return ctx.db
    .select()
    .from(terms)
    .where(
      inOrg(
        ctx,
        terms,
        academicYearId ? eq(terms.academicYearId, academicYearId) : undefined,
        afterCursor(terms, cursor),
      ),
    )
    .orderBy(asc(terms.startDate), asc(terms.id))
    .limit(limit + 1);
}

export function findTerm(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(terms)
    .where(inOrg(ctx, terms, eq(terms.id, id)))
    .get();
}

/** A term of this academic year that starts before `start` or ends after `end`, if any. */
export function termOutside(ctx: OrgCtx, academicYearId: string, start: string, end: string) {
  return ctx.db
    .select()
    .from(terms)
    .where(
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, academicYearId),
        or(sql`${terms.startDate} < ${start}`, sql`${terms.endDate} > ${end}`),
      ),
    )
    .get();
}

/** Another term of this academic year that shares a day with [start, end], if any. */
export function overlappingTerm(
  ctx: OrgCtx,
  academicYearId: string,
  start: string,
  end: string,
  exceptId?: string,
) {
  return ctx.db
    .select()
    .from(terms)
    .where(
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, academicYearId),
        overlapping(terms, start, end),
        exceptId ? ne(terms.id, exceptId) : undefined,
      ),
    )
    .get();
}

export async function termNameTaken(
  ctx: OrgCtx,
  academicYearId: string,
  name: string,
  exceptId?: string,
) {
  const row = await ctx.db
    .select({ id: terms.id })
    .from(terms)
    .where(
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, academicYearId),
        sameName(terms.name, name),
        exceptId ? ne(terms.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertTerm(ctx: OrgCtx, term: NewTermRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(terms).values(term)], {
    action: 'term.created',
    entityType: 'term',
    entityId: term.id,
    after: term,
  });
}

export async function updateTerm(ctx: OrgCtx, before: TermRow, changes: TermChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(terms)
        .set(changes)
        .where(inOrg(ctx, terms, eq(terms.id, before.id))),
    ],
    { action: 'term.updated', entityType: 'term', entityId: before.id, before, after: changes },
  );
}

export async function softDeleteTerm(ctx: OrgCtx, before: TermRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(terms)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, terms, eq(terms.id, before.id))),
    ],
    { action: 'term.deleted', entityType: 'term', entityId: before.id, before },
  );
}

// ── Holidays ────────────────────────────────────────────────────────────────

export type HolidayFilter = { from?: string; to?: string; branchId?: string };

export function listHolidays(
  ctx: OrgCtx,
  limit: number,
  cursor: DateCursor | undefined,
  filter: HolidayFilter,
) {
  const conds: (SQL | undefined)[] = [
    filter.from ? gte(holidays.endDate, filter.from) : undefined,
    filter.to ? lte(holidays.startDate, filter.to) : undefined,
    // A branch is closed by its own holidays and by organisation-wide ones.
    filter.branchId
      ? or(isNull(holidays.branchId), eq(holidays.branchId, filter.branchId))
      : undefined,
    afterCursor(holidays, cursor),
  ];
  return ctx.db
    .select()
    .from(holidays)
    .where(inOrg(ctx, holidays, ...conds))
    .orderBy(asc(holidays.startDate), asc(holidays.id))
    .limit(limit + 1);
}

export function findHoliday(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(holidays)
    .where(inOrg(ctx, holidays, eq(holidays.id, id)))
    .get();
}

/** Holidays that close only this branch (organisation-wide ones aren't counted). */
export async function countBranchHolidays(ctx: OrgCtx, branchId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(holidays)
    .where(inOrg(ctx, holidays, eq(holidays.branchId, branchId)))
    .get();
  return row?.n ?? 0;
}

export async function insertHoliday(ctx: OrgCtx, holiday: NewHolidayRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(holidays).values(holiday)], {
    action: 'holiday.created',
    entityType: 'holiday',
    entityId: holiday.id,
    after: holiday,
  });
}

export async function softDeleteHoliday(ctx: OrgCtx, before: HolidayRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(holidays)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, holidays, eq(holidays.id, before.id))),
    ],
    { action: 'holiday.deleted', entityType: 'holiday', entityId: before.id, before },
  );
}
