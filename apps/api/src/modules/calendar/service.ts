import {
  newId,
  type AcademicYear,
  type CreateAcademicYear,
  type CreateHoliday,
  type CreateTerm,
  type Holiday,
  type Term,
  type UpdateAcademicYear,
  type UpdateTerm,
} from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { byStartDate, decodeStartDateCursor, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import * as repo from './repository';

export function toAcademicYear(row: repo.AcademicYearRow): AcademicYear {
  const { orgId: _org, deletedAt: _deleted, ...year } = row;
  return year;
}

export function toTerm(row: repo.TermRow): Term {
  const { orgId: _org, deletedAt: _deleted, ...term } = row;
  return term;
}

export function toHoliday(row: repo.HolidayRow): Holiday {
  const { orgId: _org, deletedAt: _deleted, ...holiday } = row;
  return holiday;
}

/** The dates a PATCH leaves behind: the new ones where given, else the stored ones. */
function mergedDates(
  before: { startDate: string; endDate: string },
  input: { startDate?: string; endDate?: string },
) {
  const startDate = input.startDate ?? before.startDate;
  const endDate = input.endDate ?? before.endDate;
  if (endDate < startDate) throw validationFailed({ endDate: ['Must be on or after startDate'] });
  return {
    startDate,
    endDate,
    changed: startDate !== before.startDate || endDate !== before.endDate,
  };
}

const range = (r: { startDate: string; endDate: string }) => `${r.startDate} to ${r.endDate}`;

// ── Academic years ──────────────────────────────────────────────────────────

export async function listAcademicYears(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listAcademicYears(ctx, limit, decodeStartDateCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toAcademicYear), nextCursor };
}

async function findAcademicYearOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findAcademicYear(ctx, id);
  if (!row) throw notFound('Academic year');
  return row;
}

async function getAcademicYear(ctx: OrgCtx, id: string): Promise<AcademicYear> {
  return toAcademicYear(await findAcademicYearOr404(ctx, id));
}

async function refuseYearOverlap(ctx: OrgCtx, start: string, end: string, exceptId?: string) {
  const other = await repo.overlappingAcademicYear(ctx, start, end, exceptId);
  if (other) {
    throw unprocessable(`Academic years can't overlap. "${other.name}" runs ${range(other)}.`);
  }
}

const yearNameTaken = () =>
  conflict('An academic year with that name already exists', { name: ['Taken'] });

export async function createAcademicYear(
  ctx: OrgCtx,
  input: CreateAcademicYear,
): Promise<AcademicYear> {
  await refuseYearOverlap(ctx, input.startDate, input.endDate);
  if (await repo.academicYearNameTaken(ctx, input.name)) throw yearNameTaken();

  const id = newId('academicYear');
  await repo.insertAcademicYear(ctx, { id, orgId: ctx.orgId, ...input });
  return getAcademicYear(ctx, id);
}

/** New dates must still hold every term of the year, and not overlap another year. */
export async function updateAcademicYear(
  ctx: OrgCtx,
  id: string,
  input: UpdateAcademicYear,
): Promise<AcademicYear> {
  const before = await findAcademicYearOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toAcademicYear(before);

  const dates = mergedDates(before, changes);
  if (dates.changed) {
    await refuseYearOverlap(ctx, dates.startDate, dates.endDate, id);
    const outside = await repo.termOutside(ctx, id, dates.startDate, dates.endDate);
    if (outside) {
      throw unprocessable(
        `"${outside.name}" (${range(outside)}) would fall outside the academic year. Change the term first.`,
      );
    }
  }
  if (changes.name !== undefined && (await repo.academicYearNameTaken(ctx, changes.name, id))) {
    throw yearNameTaken();
  }

  await repo.updateAcademicYear(ctx, before, changes);
  return getAcademicYear(ctx, id);
}

// ── Terms ───────────────────────────────────────────────────────────────────

export async function listTerms(
  ctx: OrgCtx,
  limit: number,
  cursor?: string,
  academicYearId?: string,
) {
  if (academicYearId) await findAcademicYearOr404(ctx, academicYearId);
  const rows = await repo.listTerms(ctx, limit, decodeStartDateCursor(cursor), academicYearId);
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toTerm), nextCursor };
}

async function findTermOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findTerm(ctx, id);
  if (!row) throw notFound('Term');
  return row;
}

async function getTerm(ctx: OrgCtx, id: string): Promise<Term> {
  return toTerm(await findTermOr404(ctx, id));
}

/** A term sits inside its academic year and doesn't overlap the year's other terms. */
async function checkTermDates(
  ctx: OrgCtx,
  year: repo.AcademicYearRow,
  start: string,
  end: string,
  exceptId?: string,
) {
  if (start < year.startDate || end > year.endDate) {
    throw unprocessable(
      `A term must sit inside its academic year. "${year.name}" runs ${range(year)}.`,
    );
  }
  const other = await repo.overlappingTerm(ctx, year.id, start, end, exceptId);
  if (other) {
    throw unprocessable(`Terms can't overlap. "${other.name}" runs ${range(other)}.`);
  }
}

const termNameTaken = () =>
  conflict('A term with that name already exists in this academic year', { name: ['Taken'] });

export async function createTerm(ctx: OrgCtx, input: CreateTerm): Promise<Term> {
  const year = await findAcademicYearOr404(ctx, input.academicYearId);
  await checkTermDates(ctx, year, input.startDate, input.endDate);
  if (await repo.termNameTaken(ctx, year.id, input.name)) throw termNameTaken();

  const id = newId('term');
  await repo.insertTerm(ctx, { id, orgId: ctx.orgId, ...input });
  return getTerm(ctx, id);
}

export async function updateTerm(ctx: OrgCtx, id: string, input: UpdateTerm): Promise<Term> {
  const before = await findTermOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toTerm(before);

  const dates = mergedDates(before, changes);
  if (dates.changed) {
    const year = await findAcademicYearOr404(ctx, before.academicYearId);
    await checkTermDates(ctx, year, dates.startDate, dates.endDate, id);
  }
  if (
    changes.name !== undefined &&
    (await repo.termNameTaken(ctx, before.academicYearId, changes.name, id))
  ) {
    throw termNameTaken();
  }

  await repo.updateTerm(ctx, before, changes);
  return getTerm(ctx, id);
}

export async function deleteTerm(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findTermOr404(ctx, id);
  await repo.softDeleteTerm(ctx, before);
}

// ── Holidays ────────────────────────────────────────────────────────────────

export async function listHolidays(
  ctx: OrgCtx,
  limit: number,
  cursor: string | undefined,
  filter: repo.HolidayFilter,
) {
  if (filter.branchId) await branches.getBranch(ctx, filter.branchId);
  const rows = await repo.listHolidays(ctx, limit, decodeStartDateCursor(cursor), filter);
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toHoliday), nextCursor };
}

async function findHolidayOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findHoliday(ctx, id);
  if (!row) throw notFound('Holiday');
  return row;
}

/** Holidays aren't tied to an academic year, so a break can span the end of one. */
export async function createHoliday(ctx: OrgCtx, input: CreateHoliday): Promise<Holiday> {
  const branchId = input.branchId ?? null;
  if (branchId) await branches.getBranch(ctx, branchId);

  const id = newId('holiday');
  await repo.insertHoliday(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    branchId,
  });
  return toHoliday(await findHolidayOr404(ctx, id));
}

export async function deleteHoliday(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findHolidayOr404(ctx, id);
  await repo.softDeleteHoliday(ctx, before);
}

/** Holidays that close only this branch. A branch can't be deleted while it has any. */
export function countBranchHolidays(ctx: OrgCtx, branchId: string) {
  return repo.countBranchHolidays(ctx, branchId);
}
