import { courses, gradeLevels, now, subjects } from '@edustrux/db';
import { asc, count, eq, gt, isNull, max, ne, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type GradeLevelRow = typeof gradeLevels.$inferSelect;
export type NewGradeLevelRow = typeof gradeLevels.$inferInsert;
export type SubjectRow = typeof subjects.$inferSelect;
export type NewSubjectRow = typeof subjects.$inferInsert;
export type CourseRow = typeof courses.$inferSelect;
export type NewCourseRow = typeof courses.$inferInsert;
export type CourseChanges = Partial<
  Pick<
    NewCourseRow,
    | 'curriculum'
    | 'teachingMedium'
    | 'defaultPriceAmount'
    | 'defaultPriceCurrency'
    | 'durationMinutes'
  >
>;
export type CourseFilter = { subjectId?: string; gradeLevelId?: string };
/** What makes a course unique in its org. */
export type CourseKey = Pick<
  CourseRow,
  'subjectId' | 'gradeLevelId' | 'curriculum' | 'teachingMedium'
>;

// ── Grade levels ────────────────────────────────────────────────────────────

/** Every grade level in the org, in grade order. The service caps how many an org can have. */
export function listGradeLevels(ctx: OrgCtx) {
  return ctx.db
    .select()
    .from(gradeLevels)
    .where(inOrg(ctx, gradeLevels))
    .orderBy(asc(gradeLevels.sortOrder), asc(gradeLevels.id));
}

export function findGradeLevel(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(gradeLevels)
    .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, id)))
    .get();
}

/** How many grade levels the org has, and the highest position in use (0 if none). */
export async function gradeLevelStats(ctx: OrgCtx) {
  const row = await ctx.db
    .select({ n: count(), last: max(gradeLevels.sortOrder) })
    .from(gradeLevels)
    .where(inOrg(ctx, gradeLevels))
    .get();
  return { count: row?.n ?? 0, lastSortOrder: row?.last ?? 0 };
}

/** Case-insensitive, among the org's grade levels that aren't deleted. */
export async function gradeLevelNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ id: gradeLevels.id })
    .from(gradeLevels)
    .where(
      inOrg(
        ctx,
        gradeLevels,
        sql`lower(${gradeLevels.name}) = lower(${name})`,
        exceptId ? ne(gradeLevels.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertGradeLevel(ctx: OrgCtx, grade: NewGradeLevelRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(gradeLevels).values(grade)], {
    action: 'grade_level.created',
    entityType: 'grade_level',
    entityId: grade.id,
    after: grade,
  });
}

export async function updateGradeLevel(ctx: OrgCtx, before: GradeLevelRow, name: string) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(gradeLevels)
        .set({ name })
        .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, before.id))),
    ],
    {
      action: 'grade_level.updated',
      entityType: 'grade_level',
      entityId: before.id,
      before,
      after: { name },
    },
  );
}

export async function softDeleteGradeLevel(ctx: OrgCtx, before: GradeLevelRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(gradeLevels)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, before.id))),
    ],
    { action: 'grade_level.deleted', entityType: 'grade_level', entityId: before.id, before },
  );
}

/** Sets every grade's position (1 = first) in one batch, with one audit row for the change. */
export async function reorderGradeLevels(ctx: OrgCtx, beforeIds: string[], ids: string[]) {
  await writeWithAudit(
    ctx,
    ids.map((id, i) =>
      ctx.db
        .update(gradeLevels)
        .set({ sortOrder: i + 1 })
        .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, id))),
    ),
    {
      action: 'grade_level.reordered',
      entityType: 'grade_level',
      entityId: ctx.orgId,
      before: { ids: beforeIds },
      after: { ids },
    },
  );
}

// ── Subjects ────────────────────────────────────────────────────────────────

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listSubjects(ctx: OrgCtx, limit: number, afterId?: string) {
  return ctx.db
    .select()
    .from(subjects)
    .where(inOrg(ctx, subjects, afterId ? gt(subjects.id, afterId) : undefined))
    .orderBy(asc(subjects.id))
    .limit(limit + 1);
}

export function findSubject(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(subjects)
    .where(inOrg(ctx, subjects, eq(subjects.id, id)))
    .get();
}

/** Case-insensitive, among the org's subjects that aren't deleted. */
export async function subjectNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      inOrg(
        ctx,
        subjects,
        sql`lower(${subjects.name}) = lower(${name})`,
        exceptId ? ne(subjects.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertSubject(ctx: OrgCtx, subject: NewSubjectRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(subjects).values(subject)], {
    action: 'subject.created',
    entityType: 'subject',
    entityId: subject.id,
    after: subject,
  });
}

export async function updateSubject(ctx: OrgCtx, before: SubjectRow, name: string) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(subjects)
        .set({ name })
        .where(inOrg(ctx, subjects, eq(subjects.id, before.id))),
    ],
    {
      action: 'subject.updated',
      entityType: 'subject',
      entityId: before.id,
      before,
      after: { name },
    },
  );
}

export async function softDeleteSubject(ctx: OrgCtx, before: SubjectRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(subjects)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, subjects, eq(subjects.id, before.id))),
    ],
    { action: 'subject.deleted', entityType: 'subject', entityId: before.id, before },
  );
}

// ── Courses ─────────────────────────────────────────────────────────────────

const courseFilter = (filter: CourseFilter) => [
  filter.subjectId ? eq(courses.subjectId, filter.subjectId) : undefined,
  filter.gradeLevelId ? eq(courses.gradeLevelId, filter.gradeLevelId) : undefined,
];

/** Case-insensitive match on an optional label; "not set" only matches "not set". */
const sameLabel = (column: SQLiteColumn, value: string | null) =>
  value === null ? isNull(column) : sql`lower(${column}) = lower(${value})`;

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listCourses(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: CourseFilter,
) {
  return ctx.db
    .select()
    .from(courses)
    .where(
      inOrg(ctx, courses, ...courseFilter(filter), afterId ? gt(courses.id, afterId) : undefined),
    )
    .orderBy(asc(courses.id))
    .limit(limit + 1);
}

export function findCourse(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(courses)
    .where(inOrg(ctx, courses, eq(courses.id, id)))
    .get();
}

/** How many courses use a subject or a grade level. Neither can be deleted while any do. */
export async function countCourses(ctx: OrgCtx, filter: CourseFilter) {
  const row = await ctx.db
    .select({ n: count() })
    .from(courses)
    .where(inOrg(ctx, courses, ...courseFilter(filter)))
    .get();
  return row?.n ?? 0;
}

/** Whether the org already has a course with this subject, grade level, curriculum and medium. */
export async function courseTaken(ctx: OrgCtx, key: CourseKey, exceptId?: string) {
  const row = await ctx.db
    .select({ id: courses.id })
    .from(courses)
    .where(
      inOrg(
        ctx,
        courses,
        eq(courses.subjectId, key.subjectId),
        eq(courses.gradeLevelId, key.gradeLevelId),
        sameLabel(courses.curriculum, key.curriculum),
        sameLabel(courses.teachingMedium, key.teachingMedium),
        exceptId ? ne(courses.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertCourse(ctx: OrgCtx, course: NewCourseRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(courses).values(course)], {
    action: 'course.created',
    entityType: 'course',
    entityId: course.id,
    after: course,
  });
}

export async function updateCourse(ctx: OrgCtx, before: CourseRow, changes: CourseChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(courses)
        .set(changes)
        .where(inOrg(ctx, courses, eq(courses.id, before.id))),
    ],
    { action: 'course.updated', entityType: 'course', entityId: before.id, before, after: changes },
  );
}

export async function softDeleteCourse(ctx: OrgCtx, before: CourseRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(courses)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, courses, eq(courses.id, before.id))),
    ],
    { action: 'course.deleted', entityType: 'course', entityId: before.id, before },
  );
}
