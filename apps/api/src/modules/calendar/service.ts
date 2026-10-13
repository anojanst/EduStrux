import {
  localNow,
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
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
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

/** What an error message says about the year or term that is in the way. */
type Named = { name: string; startDate: string; endDate: string };

// ── Academic years ──────────────────────────────────────────────────────────

export async function listAcademicYears(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listAcademicYears(ctx, limit, decodeStartDateCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toAcademicYear), nextCursor };
}

export async function getAcademicYear(ctx: OrgCtx, id: string): Promise<AcademicYear> {
  const row = await repo.findAcademicYear(ctx, id);
  if (!row) throw notFound('Academic year');
  return toAcademicYear(row);
}

/**
 * Every academic year in start-date order, and which one is current: the year today falls in
 * (in the org's timezone); between years, the one that ended last; before the first year, that
 * first one. null only when the org has no academic years.
 */
export async function academicYears(ctx: OrgCtx) {
  const years = (await repo.allAcademicYears(ctx)).map(toAcademicYear);
  const { timezone } = await orgs.getOrg(ctx);
  const today = localNow(timezone).date;
  const current =
    years.find((y) => y.startDate <= today && today <= y.endDate) ??
    years.findLast((y) => y.endDate < today) ??
    years[0] ??
    null;
  return { years, current };
}

const yearsOverlap = (other: Named) =>
  unprocessable(`Academic years can't overlap. "${other.name}" runs ${range(other)}.`);

const yearNameTaken = () =>
  conflict('An academic year with that name already exists', { name: ['Taken'] });

export async function createAcademicYear(
  ctx: OrgCtx,
  input: CreateAcademicYear,
): Promise<AcademicYear> {
  // Neither check needs the other's answer, so they go to D1 together.
  const [other, nameTaken] = await Promise.all([
    repo.overlappingAcademicYear(ctx, input.startDate, input.endDate),
    repo.academicYearNameTaken(ctx, input.name),
  ]);
  if (other) throw yearsOverlap(other);
  if (nameTaken) throw yearNameTaken();

  const row = await repo.insertAcademicYear(ctx, {
    id: newId('academicYear'),
    orgId: ctx.orgId,
    ...input,
  });
  return toAcademicYear(row);
}

/** New dates must still hold every term of the year, and not overlap another year. */
export async function updateAcademicYear(
  ctx: OrgCtx,
  id: string,
  input: UpdateAcademicYear,
): Promise<AcademicYear> {
  const { updatedAt, ...changes } = input;
  const newDates = changes.startDate !== undefined || changes.endDate !== undefined;
  // The year and every check on the change go to D1 together. The date checks read the date
  // that wasn't sent from the stored year themselves.
  const [before, other, outside, nameTaken] = await Promise.all([
    repo.findAcademicYear(ctx, id),
    newDates ? repo.otherYearOverlapping(ctx, id, changes) : undefined,
    newDates ? repo.termLeftOutside(ctx, id, changes) : undefined,
    changes.name !== undefined ? repo.academicYearNameTaken(ctx, changes.name, id) : false,
  ]);
  if (!before) throw notFound('Academic year');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toAcademicYear(before);

  const dates = mergedDates(before, changes);
  if (dates.changed) {
    if (other) throw yearsOverlap(other);
    if (outside) {
      throw unprocessable(
        `"${outside.name}" (${range(outside)}) would fall outside the academic year. Change the term first.`,
      );
    }
  }
  if (nameTaken) throw yearNameTaken();

  const updated = await repo.updateAcademicYear(ctx, before, changes);
  if (!updated) throw notFound('Academic year');
  return toAcademicYear(updated);
}

// ── Terms ───────────────────────────────────────────────────────────────────

export async function listTerms(
  ctx: OrgCtx,
  limit: number,
  cursor?: string,
  academicYearId?: string,
) {
  const [year, rows] = await Promise.all([
    academicYearId ? repo.findAcademicYear(ctx, academicYearId) : undefined,
    repo.listTerms(ctx, limit, decodeStartDateCursor(cursor), academicYearId),
  ]);
  if (academicYearId && !year) throw notFound('Academic year');
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toTerm), nextCursor };
}

export async function getTerm(ctx: OrgCtx, id: string): Promise<Term> {
  const row = await repo.findTerm(ctx, id);
  if (!row) throw notFound('Term');
  return toTerm(row);
}

/**
 * A term sits inside its academic year and doesn't overlap the year's other terms. `other` is
 * a term its dates overlap, if the caller found one.
 */
function checkTermDates(
  year: repo.AcademicYearRow,
  dates: { startDate: string; endDate: string },
  other: Named | undefined,
) {
  if (dates.startDate < year.startDate || dates.endDate > year.endDate) {
    throw unprocessable(
      `A term must sit inside its academic year. "${year.name}" runs ${range(year)}.`,
    );
  }
  if (other) {
    throw unprocessable(`Terms can't overlap. "${other.name}" runs ${range(other)}.`);
  }
}

const termNameTaken = () =>
  conflict('A term with that name already exists in this academic year', { name: ['Taken'] });

export async function createTerm(ctx: OrgCtx, input: CreateTerm): Promise<Term> {
  // The two checks need only the year's id, so they go to D1 together with the read of the year.
  const [year, other, nameTaken] = await Promise.all([
    repo.findAcademicYear(ctx, input.academicYearId),
    repo.overlappingTerm(ctx, input.academicYearId, input.startDate, input.endDate),
    repo.termNameTaken(ctx, input.academicYearId, input.name),
  ]);
  if (!year) throw notFound('Academic year');
  checkTermDates(year, input, other);
  if (nameTaken) throw termNameTaken();

  const row = await repo.insertTerm(ctx, { id: newId('term'), orgId: ctx.orgId, ...input });
  return toTerm(row);
}

export async function updateTerm(ctx: OrgCtx, id: string, input: UpdateTerm): Promise<Term> {
  const { updatedAt, ...changes } = input;
  const newDates = changes.startDate !== undefined || changes.endDate !== undefined;
  // The term, its year and every check on the change go to D1 together. The checks find the
  // term's year, and the date that wasn't sent, from the stored term themselves.
  const [found, other, nameTaken] = await Promise.all([
    repo.findTermWithYear(ctx, id),
    newDates ? repo.otherTermOverlapping(ctx, id, changes) : undefined,
    changes.name !== undefined ? repo.otherTermHasName(ctx, id, changes.name) : false,
  ]);
  if (!found) throw notFound('Term');
  const before = found.term;
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toTerm(before);

  const dates = mergedDates(before, changes);
  if (dates.changed) {
    if (!found.year) throw notFound('Academic year');
    checkTermDates(found.year, dates, other);
  }
  if (nameTaken) throw termNameTaken();

  const updated = await repo.updateTerm(ctx, before, changes);
  if (!updated) throw notFound('Term');
  return toTerm(updated);
}

/** Refused while a class runs in the term. */
export async function deleteTerm(ctx: OrgCtx, id: string): Promise<void> {
  const [before, classCount] = await Promise.all([
    repo.findTerm(ctx, id),
    classes.countClasses(ctx, { termId: id }),
  ]);
  if (!before) throw notFound('Term');
  if (classCount > 0) {
    throw unprocessable(`Delete this term's ${classCount} class(es) first.`);
  }
  await repo.softDeleteTerm(ctx, before);
}

// ── Holidays ────────────────────────────────────────────────────────────────

export async function listHolidays(
  ctx: OrgCtx,
  limit: number,
  cursor: string | undefined,
  filter: repo.HolidayFilter,
) {
  // The branch check and the page go to D1 together. An unknown branch is still a 404.
  const [rows] = await Promise.all([
    repo.listHolidays(ctx, limit, decodeStartDateCursor(cursor), filter),
    filter.branchId ? branches.getBranch(ctx, filter.branchId) : undefined,
  ]);
  const { data, nextCursor } = toPage(rows, limit, byStartDate);
  return { data: data.map(toHoliday), nextCursor };
}

/**
 * Holidays aren't tied to an academic year, so a break can span the end of one. Sessions already
 * generated on the closed dates, and not yet started, are removed with it.
 */
export async function createHoliday(ctx: OrgCtx, input: CreateHoliday): Promise<Holiday> {
  const branchId = input.branchId ?? null;
  const holiday = {
    id: newId('holiday'),
    orgId: ctx.orgId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    branchId,
  };
  // Counting the sessions it closes doesn't need the branch's row, so both go to D1 together.
  // An unknown branch is still a 404, and nothing is written.
  const [closing] = await Promise.all([
    classes.sessionsClosedBy(ctx, holiday),
    branchId ? branches.getBranch(ctx, branchId) : undefined,
  ]);
  return toHoliday(await repo.insertHoliday(ctx, holiday, closing));
}

/** The date ranges on which a branch is closed between two dates: its own holidays and org-wide ones. */
export function closedRanges(ctx: OrgCtx, branchId: string, from: string, to: string) {
  return repo.closedRanges(ctx, branchId, from, to);
}

export async function deleteHoliday(ctx: OrgCtx, id: string): Promise<void> {
  const before = await repo.findHoliday(ctx, id);
  if (!before) throw notFound('Holiday');
  await repo.softDeleteHoliday(ctx, before);
}

/** Holidays that close only this branch. A branch can't be deleted while it has any. */
export function countBranchHolidays(ctx: OrgCtx, branchId: string) {
  return repo.countBranchHolidays(ctx, branchId);
}
