import {
  MAX_GRADE_LEVELS,
  newId,
  type CreateGradeLevel,
  type CreateSubject,
  type GradeLevel,
  type Subject,
  type UpdateGradeLevel,
  type UpdateSubject,
} from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData, unprocessable } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as repo from './repository';

export function toGradeLevel(row: repo.GradeLevelRow): GradeLevel {
  const { orgId: _org, deletedAt: _deleted, ...grade } = row;
  return grade;
}

export function toSubject(row: repo.SubjectRow): Subject {
  const { orgId: _org, deletedAt: _deleted, ...subject } = row;
  return subject;
}

const gradeNameTaken = () =>
  conflict('A grade level with that name already exists', { name: ['Taken'] });
const subjectNameTaken = () =>
  conflict('A subject with that name already exists', { name: ['Taken'] });

// ── Grade levels ────────────────────────────────────────────────────────────

/** The whole list in grade order: it's capped at MAX_GRADE_LEVELS, so it isn't paged. */
export async function listGradeLevels(ctx: OrgCtx) {
  const rows = await repo.listGradeLevels(ctx);
  return { data: rows.map(toGradeLevel), nextCursor: null };
}

async function findGradeLevelOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findGradeLevel(ctx, id);
  if (!row) throw notFound('Grade level');
  return row;
}

async function getGradeLevel(ctx: OrgCtx, id: string): Promise<GradeLevel> {
  return toGradeLevel(await findGradeLevelOr404(ctx, id));
}

/** New grade levels go to the end of the order. */
export async function createGradeLevel(ctx: OrgCtx, input: CreateGradeLevel): Promise<GradeLevel> {
  const stats = await repo.gradeLevelStats(ctx);
  if (stats.count >= MAX_GRADE_LEVELS) {
    throw unprocessable(`An organisation can have at most ${MAX_GRADE_LEVELS} grade levels.`);
  }
  if (await repo.gradeLevelNameTaken(ctx, input.name)) throw gradeNameTaken();

  const id = newId('gradeLevel');
  await repo.insertGradeLevel(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    sortOrder: stats.lastSortOrder + 1,
  });
  return getGradeLevel(ctx, id);
}

export async function updateGradeLevel(
  ctx: OrgCtx,
  id: string,
  input: UpdateGradeLevel,
): Promise<GradeLevel> {
  const before = await findGradeLevelOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (input.name === undefined) return toGradeLevel(before);

  if (await repo.gradeLevelNameTaken(ctx, input.name, id)) throw gradeNameTaken();
  await repo.updateGradeLevel(ctx, before, input.name);
  return getGradeLevel(ctx, id);
}

export async function deleteGradeLevel(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findGradeLevelOr404(ctx, id);
  await repo.softDeleteGradeLevel(ctx, before);
}

/**
 * Puts the org's grade levels in the given order. The list must name every grade level exactly
 * once: an id the org doesn't have is 404, a missing one is 422 (duplicates fail validation).
 */
export async function reorderGradeLevels(ctx: OrgCtx, ids: string[]) {
  const current = await repo.listGradeLevels(ctx);
  const known = new Set(current.map((g) => g.id));
  if (ids.some((id) => !known.has(id))) throw notFound('Grade level');
  if (ids.length !== current.length) {
    throw unprocessable('List every grade level exactly once.', {
      ids: [`Expected ${current.length} ids, got ${ids.length}`],
    });
  }

  await repo.reorderGradeLevels(
    ctx,
    current.map((g) => g.id),
    ids,
  );
  return listGradeLevels(ctx);
}

// ── Subjects ────────────────────────────────────────────────────────────────

export async function listSubjects(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listSubjects(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toSubject), nextCursor };
}

async function findSubjectOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findSubject(ctx, id);
  if (!row) throw notFound('Subject');
  return row;
}

async function getSubject(ctx: OrgCtx, id: string): Promise<Subject> {
  return toSubject(await findSubjectOr404(ctx, id));
}

export async function createSubject(ctx: OrgCtx, input: CreateSubject): Promise<Subject> {
  if (await repo.subjectNameTaken(ctx, input.name)) throw subjectNameTaken();

  const id = newId('subject');
  await repo.insertSubject(ctx, { id, orgId: ctx.orgId, name: input.name });
  return getSubject(ctx, id);
}

export async function updateSubject(
  ctx: OrgCtx,
  id: string,
  input: UpdateSubject,
): Promise<Subject> {
  const before = await findSubjectOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (input.name === undefined) return toSubject(before);

  if (await repo.subjectNameTaken(ctx, input.name, id)) throw subjectNameTaken();
  await repo.updateSubject(ctx, before, input.name);
  return getSubject(ctx, id);
}

export async function deleteSubject(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findSubjectOr404(ctx, id);
  await repo.softDeleteSubject(ctx, before);
}
