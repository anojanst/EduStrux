import { enrolments } from '@edustrux/db';
import { asc, count, eq, gt, gte, isNull, lte, or, type SQL } from 'drizzle-orm';
import {
  idsFrom,
  inIds,
  inOrg,
  writeWithAudit,
  type IdQuery,
  type Ids,
  type OrgCtx,
} from '../../db/scope';

export type EnrolmentRow = typeof enrolments.$inferSelect;
export type NewEnrolmentRow = typeof enrolments.$inferInsert;

/**
 * The part of the org's enrolments a caller may see: every one when empty, else those in the
 * classes in `classIds` and those of the students in `studentIds`. Either is enough.
 */
export type Reach = { classIds?: Ids; studentIds?: Ids };

export type EnrolmentFilter = { studentId?: string; classId?: string };

/**
 * One list is a teacher's classes or a parent's children: a few ids, which the query goes
 * straight to. Both lists together are everything in a branch manager's branches. Those are
 * `wide`: the page is read in its own order and each enrolment looked up in them.
 */
function within(reach: Reach): SQL | undefined {
  const inClasses = reach.classIds && inIds(enrolments.classId, reach.classIds);
  const ofStudents = reach.studentIds && inIds(enrolments.studentId, reach.studentIds);
  return inClasses && ofStudents ? or(inClasses, ofStudents) : (inClasses ?? ofStudents);
}

const active = eq(enrolments.status, 'active');

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listEnrolments(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: EnrolmentFilter,
  reach: Reach,
) {
  return ctx.db
    .select()
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        filter.studentId ? eq(enrolments.studentId, filter.studentId) : undefined,
        filter.classId ? eq(enrolments.classId, filter.classId) : undefined,
        within(reach),
        afterId ? gt(enrolments.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(enrolments.id))
    .limit(limit + 1);
}

export function findEnrolment(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(enrolments)
    .where(inOrg(ctx, enrolments, eq(enrolments.id, id)))
    .get();
}

/** Whether the student already holds an active enrolment in the class. */
export async function alreadyEnrolled(ctx: OrgCtx, studentId: string, classId: string) {
  const row = await ctx.db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        eq(enrolments.studentId, studentId),
        eq(enrolments.classId, classId),
        active,
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * The places taken in a class for someone starting on `date`: its active enrolments that haven't
 * ended by then. One that starts later still holds its place.
 */
export async function countPlacesTaken(ctx: OrgCtx, classId: string, date: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        eq(enrolments.classId, classId),
        active,
        or(isNull(enrolments.endDate), gte(enrolments.endDate, date)),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** How many enrolments a class or a student has, whatever their status. */
export async function countEnrolments(ctx: OrgCtx, filter: EnrolmentFilter) {
  const row = await ctx.db
    .select({ n: count() })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        filter.studentId ? eq(enrolments.studentId, filter.studentId) : undefined,
        filter.classId ? eq(enrolments.classId, filter.classId) : undefined,
      ),
    )
    .get();
  return row?.n ?? 0;
}

export async function insertEnrolment(ctx: OrgCtx, row: NewEnrolmentRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(enrolments).values(row)], {
    action: 'enrolment.created',
    entityType: 'enrolment',
    entityId: row.id,
    after: row,
  });
}

/** The classes any of these students holds an active enrolment in, as ids to filter by. */
export function activeClasses(ctx: OrgCtx, studentIds: Ids): IdQuery {
  return idsFrom(
    ctx,
    enrolments,
    enrolments.classId,
    inIds(enrolments.studentId, studentIds),
    active,
  );
}

/** The students who hold an active enrolment in any of these classes, as ids to filter by. */
export function activeStudents(ctx: OrgCtx, classIds: Ids): IdQuery {
  return idsFrom(
    ctx,
    enrolments,
    enrolments.studentId,
    inIds(enrolments.classId, classIds),
    active,
  );
}

/**
 * The students whose active enrolment in the class covers `date`. A student has at most one
 * active enrolment in a class, so no id comes back twice. Asking for DISTINCT anyway makes SQLite
 * read every enrolment in the org, in student order, instead of the class's own.
 */
export async function activeStudentIdsOn(ctx: OrgCtx, classId: string, date: string) {
  const rows = await ctx.db
    .select({ id: enrolments.studentId })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        eq(enrolments.classId, classId),
        active,
        lte(enrolments.startDate, date),
        or(isNull(enrolments.endDate), gte(enrolments.endDate, date)),
      ),
    );
  return rows.map((row) => row.id);
}

/** The student's active enrolments: each one's class and the dates it covers. */
export function activeSpans(ctx: OrgCtx, studentId: string) {
  return ctx.db
    .select({
      classId: enrolments.classId,
      startDate: enrolments.startDate,
      endDate: enrolments.endDate,
    })
    .from(enrolments)
    .where(inOrg(ctx, enrolments, eq(enrolments.studentId, studentId), active));
}

/** The active enrolments in these classes that cover some part of the dates, both included. */
export function activeDuring(
  ctx: OrgCtx,
  classIds: Ids,
  range: { startDate: string; endDate: string },
) {
  return ctx.db
    .select()
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        inIds(enrolments.classId, classIds),
        active,
        lte(enrolments.startDate, range.endDate),
        or(isNull(enrolments.endDate), gte(enrolments.endDate, range.startDate)),
      ),
    )
    .orderBy(asc(enrolments.id));
}
