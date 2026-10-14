import { courses, gradeLevels, now, subjects } from '@edustrux/db';
import { asc, count, eq, gt, isNull, max, ne, sql } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { changedFields, inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

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

/** Returns the grade level as stored, from the same batch, so the caller doesn't read it back. */
export async function insertGradeLevel(
  ctx: OrgCtx,
  grade: NewGradeLevelRow & { id: string },
): Promise<GradeLevelRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(gradeLevels).values(grade).returning()],
    {
      action: 'grade_level.created',
      entityType: 'grade_level',
      entityId: grade.id,
      after: grade,
    },
  );
  const row = (inserted as GradeLevelRow[])[0];
  if (!row) throw new Error('Grade level missing after insert');
  return row;
}

/** Returns the grade level as updated, from the same batch. undefined if it was just deleted. */
export async function updateGradeLevel(
  ctx: OrgCtx,
  before: GradeLevelRow,
  name: string,
): Promise<GradeLevelRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(gradeLevels)
        .set({ name })
        .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, before.id)))
        .returning(),
    ],
    {
      action: 'grade_level.updated',
      entityType: 'grade_level',
      entityId: before.id,
      ...changedFields(before, { name }),
    },
  );
  return (updated as GradeLevelRow[])[0];
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

/**
 * Sets every grade's position (1 = first) in one batch, with one audit row for the change.
 * Returns the grade levels as updated, in the new order, from that batch.
 */
export async function reorderGradeLevels(
  ctx: OrgCtx,
  beforeIds: string[],
  ids: string[],
): Promise<GradeLevelRow[]> {
  const [, ...updated] = await writeWithAudit(
    ctx,
    ids.map((id, i) =>
      ctx.db
        .update(gradeLevels)
        .set({ sortOrder: i + 1 })
        .where(inOrg(ctx, gradeLevels, eq(gradeLevels.id, id)))
        .returning(),
    ),
    {
      action: 'grade_level.reordered',
      entityType: 'grade_level',
      entityId: ctx.orgId,
      before: { ids: beforeIds },
      after: { ids },
    },
  );
  // One statement per grade level, each returning the row it changed.
  return (updated as GradeLevelRow[][]).flat();
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

/** Returns the subject as stored, from the same batch, so the caller doesn't read it back. */
export async function insertSubject(
  ctx: OrgCtx,
  subject: NewSubjectRow & { id: string },
): Promise<SubjectRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(subjects).values(subject).returning()],
    { action: 'subject.created', entityType: 'subject', entityId: subject.id, after: subject },
  );
  const row = (inserted as SubjectRow[])[0];
  if (!row) throw new Error('Subject missing after insert');
  return row;
}

/** Returns the subject as updated, from the same batch. undefined if it was just deleted. */
export async function updateSubject(
  ctx: OrgCtx,
  before: SubjectRow,
  name: string,
): Promise<SubjectRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(subjects)
        .set({ name })
        .where(inOrg(ctx, subjects, eq(subjects.id, before.id)))
        .returning(),
    ],
    {
      action: 'subject.updated',
      entityType: 'subject',
      entityId: before.id,
      ...changedFields(before, { name }),
    },
  );
  return (updated as SubjectRow[])[0];
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

/** The default prices of the given courses. */
export function defaultPrices(ctx: OrgCtx, ids: string[]) {
  return ctx.db
    .select({
      id: courses.id,
      amount: courses.defaultPriceAmount,
      currency: courses.defaultPriceCurrency,
    })
    .from(courses)
    .where(inOrg(ctx, courses, inIds(courses.id, ids)));
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
export async function courseTaken(ctx: OrgCtx, key: CourseKey) {
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
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * Whether another course would be the same as this one once it has the new labels. null clears
 * a label. A label that isn't sent stays as stored, and that one, with the course's subject and
 * grade level, comes from the course's own row inside the statement, so this can be sent together
 * with the read of the course.
 */
export async function otherCourseMatches(
  ctx: OrgCtx,
  id: string,
  labels: Partial<Pick<CourseKey, 'curriculum' | 'teachingMedium'>>,
) {
  const self = alias(courses, 'self');
  // `is` matches two missing labels, as sameLabel does for a value.
  const label = (column: SQLiteColumn, stored: SQLiteColumn, value: string | null | undefined) =>
    value === undefined ? sql`lower(${column}) is lower(${stored})` : sameLabel(column, value);
  const row = await ctx.db
    .select({ id: courses.id })
    .from(self)
    .innerJoin(
      courses,
      inOrg(
        ctx,
        courses,
        eq(courses.subjectId, self.subjectId),
        eq(courses.gradeLevelId, self.gradeLevelId),
        label(courses.curriculum, self.curriculum, labels.curriculum),
        label(courses.teachingMedium, self.teachingMedium, labels.teachingMedium),
        ne(courses.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
  return row !== undefined;
}

/** Returns the course as stored, from the same batch, so the caller doesn't read it back. */
export async function insertCourse(
  ctx: OrgCtx,
  course: NewCourseRow & { id: string },
): Promise<CourseRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(courses).values(course).returning()],
    { action: 'course.created', entityType: 'course', entityId: course.id, after: course },
  );
  const row = (inserted as CourseRow[])[0];
  if (!row) throw new Error('Course missing after insert');
  return row;
}

/** Returns the course as updated, from the same batch. undefined if it was just deleted. */
export async function updateCourse(
  ctx: OrgCtx,
  before: CourseRow,
  changes: CourseChanges,
): Promise<CourseRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(courses)
        .set(changes)
        .where(inOrg(ctx, courses, eq(courses.id, before.id)))
        .returning(),
    ],
    {
      action: 'course.updated',
      entityType: 'course',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as CourseRow[])[0];
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
