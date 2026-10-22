import { enrolments } from '@edustrux/db';
import {
  asc,
  count,
  countDistinct,
  eq,
  gt,
  gte,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  changedFields,
  firstIds,
  idsFrom,
  inIds,
  inOrg,
  wide,
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

/** What one page of the list is read by: the filter, the reach, and where the page starts. */
const pageConditions = (afterId: string | undefined, filter: EnrolmentFilter, reach: Reach) => [
  filter.studentId ? eq(enrolments.studentId, filter.studentId) : undefined,
  filter.classId ? eq(enrolments.classId, filter.classId) : undefined,
  within(reach),
  afterId ? gt(enrolments.id, afterId) : undefined,
];

/**
 * The students who hold an active enrolment within the reach, as ids to filter another table by.
 * With `studentId`, only that student: a lookup by the student. Without, a branch manager's reach
 * is `wide`, a share of the org.
 */
export function activeStudentsWithin(ctx: OrgCtx, reach: Reach, studentId?: string): IdQuery {
  const ids = idsFrom(
    ctx,
    enrolments,
    enrolments.studentId,
    studentId ? inIds(enrolments.studentId, [studentId]) : undefined,
    active,
    within(reach),
  );
  return studentId || !(reach.classIds && reach.studentIds) ? ids : wide(ids);
}

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
    .where(inOrg(ctx, enrolments, ...pageConditions(afterId, filter, reach)))
    .orderBy(asc(enrolments.id))
    .limit(limit + 1);
}

/**
 * The students, or the classes, of the enrolments on that page, as ids: the first `limit` of the
 * same conditions in the same order. It lets the names a page shows be read in the same stage as
 * the page (D-104).
 */
export function onPage(
  ctx: OrgCtx,
  column: 'studentId' | 'classId',
  limit: number,
  afterId: string | undefined,
  filter: EnrolmentFilter,
  reach: Reach,
): IdQuery {
  return firstIds(
    idsFrom(ctx, enrolments, enrolments[column], ...pageConditions(afterId, filter, reach)),
    limit,
    asc(enrolments.id),
  );
}

/**
 * What enrolling a student needs to know of the class's active enrolments, in one statement:
 * whether the student already holds one, and how many places are taken.
 *
 * The places taken for someone starting on a date are the enrolments that haven't ended by
 * then. One that starts later still holds its place. That date isn't known until the class is
 * read, and this is sent together with that read, so the enrolments come back counted by their
 * last day and `takenOn` adds up the ones that count.
 */
export async function placesIn(ctx: OrgCtx, classId: string, studentId: string) {
  const rows = await ctx.db
    .select({
      endDate: enrolments.endDate,
      n: count(),
      theirs: sql<number>`max(${enrolments.studentId} = ${studentId})`,
    })
    .from(enrolments)
    .where(inOrg(ctx, enrolments, eq(enrolments.classId, classId), active))
    .groupBy(enrolments.endDate);
  return {
    alreadyEnrolled: rows.some((row) => row.theirs === 1),
    takenOn: (date: string) =>
      rows
        .filter((row) => row.endDate === null || row.endDate >= date)
        .reduce((taken, row) => taken + row.n, 0),
  };
}

/**
 * The students a plan's cap counts: those with an active enrolment that hasn't ended by `today`
 * (TUI-74). With `studentId`, also whether they are one of them already.
 */
export async function planUsage(ctx: OrgCtx, today: string, studentId = '') {
  const row = await ctx.db
    .select({
      n: countDistinct(enrolments.studentId),
      theirs: sql<number>`coalesce(max(${enrolments.studentId} = ${studentId}), 0)`,
    })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        active,
        or(isNull(enrolments.endDate), gte(enrolments.endDate, today)),
      ),
    )
    .get();
  return { count: row?.n ?? 0, counted: row?.theirs === 1 };
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

/** Returns the enrolment as stored, from the same batch, so the caller doesn't read it back. */
export async function insertEnrolment(
  ctx: OrgCtx,
  row: NewEnrolmentRow & { id: string },
): Promise<EnrolmentRow> {
  const insert = ctx.db.insert(enrolments).values(row).returning();
  const [, inserted] = await writeWithAudit(ctx, [insert], {
    action: 'enrolment.created',
    entityType: 'enrolment',
    entityId: row.id,
    after: row,
  });
  const stored = (inserted as EnrolmentRow[])[0];
  if (!stored) throw new Error('Enrolment missing after insert');
  return stored;
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

/** The active enrolments of these students, oldest first. */
export function activeOf(ctx: OrgCtx, studentIds: Ids) {
  return ctx.db
    .select()
    .from(enrolments)
    .where(inOrg(ctx, enrolments, inIds(enrolments.studentId, studentIds), active))
    .orderBy(asc(enrolments.id));
}

/**
 * The students who hold or held an enrolment in any of these classes, active or withdrawn, as
 * ids to filter by: whoever a past lesson's roster can show (TUI-46).
 */
export function rollStudents(ctx: OrgCtx, classIds: Ids): IdQuery {
  return idsFrom(ctx, enrolments, enrolments.studentId, inIds(enrolments.classId, classIds));
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

/**
 * The enrolments in these classes that cover some part of the dates, both included: active ones,
 * and withdrawn ones for the lessons before the student left (TUI-46). Their dates bound both.
 */
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
        lte(enrolments.startDate, range.endDate),
        or(isNull(enrolments.endDate), gte(enrolments.endDate, range.startDate)),
      ),
    )
    .orderBy(asc(enrolments.id));
}

// ── Changing, withdrawing and transferring (TUI-46) ─────────────────────────

export type EnrolmentChanges = Partial<
  Pick<
    NewEnrolmentRow,
    'startDate' | 'endDate' | 'priceOverrideAmount' | 'priceOverrideCurrency' | 'status'
  >
>;

/** One enrolment, if it is within reach: through its class or its student. */
export function findEnrolment(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(enrolments)
    .where(inOrg(ctx, enrolments, eq(enrolments.id, id), within(reach)))
    .get();
}

/**
 * Changes the enrolment, and with a transfer adds the new one, in one batch with the caller's
 * other statements (its invoice lines) and one audit row. Returns the enrolment as changed and
 * the new one, from that batch, so nothing is read back. The update holds only while the
 * enrolment is still as read, so a second change racing this one changes nothing.
 */
export async function changeEnrolment(
  ctx: OrgCtx,
  before: EnrolmentRow,
  changes: EnrolmentChanges,
  other: BatchItem<'sqlite'>[],
  audit: { action: string; extra: Record<string, unknown> },
  added?: NewEnrolmentRow & { id: string },
) {
  const update = ctx.db
    .update(enrolments)
    .set({ ...changes, updatedAt: new Date().toISOString() })
    .where(
      inOrg(
        ctx,
        enrolments,
        eq(enrolments.id, before.id),
        eq(enrolments.updatedAt, before.updatedAt),
      ),
    )
    .returning();
  const insert = added ? [ctx.db.insert(enrolments).values(added).returning()] : [];
  const fields = changedFields(before, changes);
  const [, updated, ...rest] = await writeWithAudit(ctx, [update, ...insert, ...other], {
    action: audit.action,
    entityType: 'enrolment',
    entityId: before.id,
    before: fields.before,
    after: { ...fields.after, ...audit.extra, ...(added ? { transferredTo: added } : {}) },
  });
  return {
    updated: (updated as EnrolmentRow[])[0],
    inserted: added ? (rest[0] as EnrolmentRow[])[0] : undefined,
  };
}

/**
 * The enrolments in these classes, active or withdrawn, each with its student, its class and the
 * dates it covers, for working out who is in two lessons at once (TUI-50).
 */
export function spansIn(ctx: OrgCtx, classIds: Ids) {
  return ctx.db
    .select({
      studentId: enrolments.studentId,
      classId: enrolments.classId,
      startDate: enrolments.startDate,
      endDate: enrolments.endDate,
    })
    .from(enrolments)
    .where(inOrg(ctx, enrolments, inIds(enrolments.classId, classIds)));
}

/** How many students hold an active enrolment within reach (TUI-62). */
export async function countActiveStudents(ctx: OrgCtx, reach: Reach) {
  const row = await ctx.db
    .select({ n: sql<number>`count(distinct ${enrolments.studentId})` })
    .from(enrolments)
    .where(inOrg(ctx, enrolments, active, within(reach)))
    .get();
  return row?.n ?? 0;
}

/** How many of these students' active enrolments haven't ended by `today` (TUI-79). */
export async function continuing(ctx: OrgCtx, studentIds: string[], today: string) {
  if (studentIds.length === 0) return 0;
  const row = await ctx.db
    .select({ n: count() })
    .from(enrolments)
    .where(
      inOrg(
        ctx,
        enrolments,
        inIds(enrolments.studentId, studentIds),
        active,
        or(isNull(enrolments.endDate), gte(enrolments.endDate, today)),
      ),
    )
    .get();
  return row?.n ?? 0;
}
