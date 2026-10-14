import { academicYears, holidays, now, terms } from '@edustrux/db';
import { and, asc, count, eq, gt, gte, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { changedFields, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

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
/** A date to compare with: a value, or another row's column. */
type DateBound = string | SQLiteColumn;
/**
 * The dates a PATCH sends. A check that takes these reads the date that wasn't sent from the
 * stored row, inside its own statement, so it can go to D1 together with the read of that row.
 */
export type NewDates = { startDate?: string; endDate?: string };

/** Rows after the cursor, in (start date, id) order. */
function afterCursor(table: Dated, cursor?: DateCursor) {
  if (!cursor) return undefined;
  return or(
    gt(table.startDate, cursor.date),
    and(eq(table.startDate, cursor.date), gt(table.id, cursor.id)),
  );
}

/** Ranges that share at least one day with [start, end] (both inclusive). */
function overlapping(table: Dated, start: DateBound, end: DateBound) {
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

/** Every academic year in start-date order. There is one a year, so this isn't paged. */
export function allAcademicYears(ctx: OrgCtx) {
  return ctx.db
    .select()
    .from(academicYears)
    .where(inOrg(ctx, academicYears))
    .orderBy(asc(academicYears.startDate), asc(academicYears.id));
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

/** An academic year that shares a day with [start, end], if any. */
export function overlappingAcademicYear(ctx: OrgCtx, start: string, end: string) {
  return ctx.db
    .select()
    .from(academicYears)
    .where(inOrg(ctx, academicYears, overlapping(academicYears, start, end)))
    .get();
}

/** Another academic year that would share a day with this one once it has the new dates, if any. */
export function otherYearOverlapping(ctx: OrgCtx, id: string, dates: NewDates) {
  const self = alias(academicYears, 'self');
  return ctx.db
    .select({
      name: academicYears.name,
      startDate: academicYears.startDate,
      endDate: academicYears.endDate,
    })
    .from(self)
    .innerJoin(
      academicYears,
      inOrg(
        ctx,
        academicYears,
        overlapping(
          academicYears,
          dates.startDate ?? self.startDate,
          dates.endDate ?? self.endDate,
        ),
        ne(academicYears.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
}

/** Returns the year as stored, from the same batch, so the caller doesn't read it back. */
export async function insertAcademicYear(
  ctx: OrgCtx,
  year: NewAcademicYearRow & { id: string },
): Promise<AcademicYearRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(academicYears).values(year).returning()],
    {
      action: 'academic_year.created',
      entityType: 'academic_year',
      entityId: year.id,
      after: year,
    },
  );
  const row = (inserted as AcademicYearRow[])[0];
  if (!row) throw new Error('Academic year missing after insert');
  return row;
}

/** Returns the year as updated, from the same batch. undefined if it was just deleted. */
export async function updateAcademicYear(
  ctx: OrgCtx,
  before: AcademicYearRow,
  changes: AcademicYearChanges,
): Promise<AcademicYearRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(academicYears)
        .set(changes)
        .where(inOrg(ctx, academicYears, eq(academicYears.id, before.id)))
        .returning(),
    ],
    {
      action: 'academic_year.updated',
      entityType: 'academic_year',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as AcademicYearRow[])[0];
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

/** A term and the academic year it belongs to, in one statement. */
export function findTermWithYear(ctx: OrgCtx, id: string) {
  return ctx.db
    .select({ term: terms, year: academicYears })
    .from(terms)
    .leftJoin(academicYears, inOrg(ctx, academicYears, eq(academicYears.id, terms.academicYearId)))
    .where(inOrg(ctx, terms, eq(terms.id, id)))
    .get();
}

/** A term of this academic year that the year's new dates would leave outside it, if any. */
export function termLeftOutside(ctx: OrgCtx, academicYearId: string, dates: NewDates) {
  return ctx.db
    .select({ name: terms.name, startDate: terms.startDate, endDate: terms.endDate })
    .from(academicYears)
    .innerJoin(
      terms,
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, academicYears.id),
        or(
          lt(terms.startDate, dates.startDate ?? academicYears.startDate),
          gt(terms.endDate, dates.endDate ?? academicYears.endDate),
        ),
      ),
    )
    .where(inOrg(ctx, academicYears, eq(academicYears.id, academicYearId)))
    .get();
}

/** A term of this academic year that shares a day with [start, end], if any. */
export function overlappingTerm(ctx: OrgCtx, academicYearId: string, start: string, end: string) {
  return ctx.db
    .select()
    .from(terms)
    .where(
      inOrg(ctx, terms, eq(terms.academicYearId, academicYearId), overlapping(terms, start, end)),
    )
    .get();
}

/**
 * Another term of the same academic year that would share a day with this one once it has the
 * new dates, if any.
 */
export function otherTermOverlapping(ctx: OrgCtx, id: string, dates: NewDates) {
  const self = alias(terms, 'self');
  return ctx.db
    .select({ name: terms.name, startDate: terms.startDate, endDate: terms.endDate })
    .from(self)
    .innerJoin(
      terms,
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, self.academicYearId),
        overlapping(terms, dates.startDate ?? self.startDate, dates.endDate ?? self.endDate),
        ne(terms.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
}

export async function termNameTaken(ctx: OrgCtx, academicYearId: string, name: string) {
  const row = await ctx.db
    .select({ id: terms.id })
    .from(terms)
    .where(inOrg(ctx, terms, eq(terms.academicYearId, academicYearId), sameName(terms.name, name)))
    .get();
  return row !== undefined;
}

/**
 * Whether another term of this term's academic year has the name. The year comes from the term's
 * own row inside the statement, so this can be sent together with the read of the term.
 */
export async function otherTermHasName(ctx: OrgCtx, id: string, name: string) {
  const self = alias(terms, 'self');
  const row = await ctx.db
    .select({ id: terms.id })
    .from(self)
    .innerJoin(
      terms,
      inOrg(
        ctx,
        terms,
        eq(terms.academicYearId, self.academicYearId),
        sameName(terms.name, name),
        ne(terms.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
  return row !== undefined;
}

/** Returns the term as stored, from the same batch, so the caller doesn't read it back. */
export async function insertTerm(ctx: OrgCtx, term: NewTermRow & { id: string }): Promise<TermRow> {
  const [, inserted] = await writeWithAudit(ctx, [ctx.db.insert(terms).values(term).returning()], {
    action: 'term.created',
    entityType: 'term',
    entityId: term.id,
    after: term,
  });
  const row = (inserted as TermRow[])[0];
  if (!row) throw new Error('Term missing after insert');
  return row;
}

/** Returns the term as updated, from the same batch. undefined if it was just deleted. */
export async function updateTerm(
  ctx: OrgCtx,
  before: TermRow,
  changes: TermChanges,
): Promise<TermRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(terms)
        .set(changes)
        .where(inOrg(ctx, terms, eq(terms.id, before.id)))
        .returning(),
    ],
    {
      action: 'term.updated',
      entityType: 'term',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as TermRow[])[0];
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

/** Every holiday that closes the branch on a date from `from` to `to`, org-wide ones included. */
export function closedRanges(ctx: OrgCtx, branchId: string, from: string, to: string) {
  return ctx.db
    .select({ startDate: holidays.startDate, endDate: holidays.endDate })
    .from(holidays)
    .where(
      inOrg(
        ctx,
        holidays,
        overlapping(holidays, from, to),
        or(isNull(holidays.branchId), eq(holidays.branchId, branchId)),
      ),
    );
}

/**
 * `closing` removes the sessions the holiday closes, in the same batch; how many is recorded in
 * the holiday's audit row. Returns the holiday as stored, from that batch.
 */
export async function insertHoliday(
  ctx: OrgCtx,
  holiday: NewHolidayRow & { id: string },
  closing: { count: number; statements: BatchItem<'sqlite'>[] },
): Promise<HolidayRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(holidays).values(holiday).returning(), ...closing.statements],
    {
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: holiday.id,
      after: { ...holiday, sessionsRemoved: closing.count },
    },
  );
  const row = (inserted as HolidayRow[])[0];
  if (!row) throw new Error('Holiday missing after insert');
  return row;
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
