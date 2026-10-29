import { classSchedules, classes, now, sessions } from '@edustrux/db';
import type { AttendanceStatus } from '@edustrux/shared';
import { and, asc, count, eq, gt, gte, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
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
import type { DateRange, LocalMoment } from './schedule';

export type ClassRow = typeof classes.$inferSelect;
export type NewClassRow = typeof classes.$inferInsert;
export type ClassChanges = Partial<
  Pick<
    NewClassRow,
    'roomId' | 'teacherMembershipId' | 'name' | 'capacity' | 'startDate' | 'endDate'
  >
>;
export type SlotRow = typeof classSchedules.$inferSelect;
export type NewSlotRow = typeof classSchedules.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

/**
 * The part of the org's classes a caller may see or change: every class when empty, else only
 * those in `branchIds`, or taught by `teacherMembershipId`, or listed in `classIds`.
 */
export type Reach = { branchIds?: string[]; teacherMembershipId?: string; classIds?: Ids };

export type ClassFilter = {
  branchId?: string;
  termId?: string;
  courseId?: string;
  gradeLevelId?: string;
  teacherId?: string;
  roomId?: string;
};
export type SessionFilter = {
  from: string;
  to: string;
  branchId?: string;
  roomId?: string;
  teacherId?: string;
  gradeLevelId?: string;
  classId?: string;
  /**
   * A student's timetable: only the sessions of the classes they are enrolled in, on the dates an
   * enrolment covers. `coveredOn` is given the session's date column and worked out row by row.
   */
  enrolled?: { classes: Ids; coveredOn: (date: SQLiteColumn) => Ids };
};
type SessionCursor = { date: string; time: string; id: string };

/** Sessions to add and remove so a class's upcoming sessions match its schedule. */
export type SessionPlan = { add: NewSessionRow[]; removeIds: string[] };

// D1 binds at most 100 values per statement. A session row binds up to 11 and a slot row 8.
const SESSIONS_PER_INSERT = 9;
const SLOTS_PER_INSERT = 12;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The reach as separate conditions, for `inOrg` to find a list of ids to go to among them. */
const reachConditions = (reach: Reach) => [
  reach.branchIds ? inIds(classes.branchId, reach.branchIds) : undefined,
  reach.teacherMembershipId
    ? eq(classes.teacherMembershipId, reach.teacherMembershipId)
    : undefined,
  reach.classIds ? inIds(classes.id, reach.classIds) : undefined,
];

/** The reach as one condition, which only narrows what the rest of the query finds. */
function within(reach: Reach): SQL | undefined {
  return and(...reachConditions(reach));
}

/** Whether the reach is a few classes: a teacher's or a parent's, not a branch's or the org's. */
const fewClasses = (reach: Reach) =>
  reach.teacherMembershipId !== undefined || reach.classIds !== undefined;

/**
 * The reach as a condition on sessions. A teacher's or a parent's are the sessions of a few
 * classes, which `inOrg` goes to. Branch staff's are a big share of the org's: those are read in
 * date order, and `within` checks the class each one is read with.
 */
const sessionReach = (ctx: OrgCtx, reach: Reach) =>
  fewClasses(reach) ? inIds(sessions.classId, classesWithin(ctx, reach)) : undefined;

/**
 * A student's timetable as conditions on sessions. The first is ids `inOrg` can go to: the
 * student's classes. The second reads each row's own date, so it can only narrow what the first
 * finds, and must stay after it.
 */
const enrolledIn = (enrolled: NonNullable<SessionFilter['enrolled']>) => [
  inIds(sessions.classId, enrolled.classes),
  inIds(sessions.classId, enrolled.coveredOn(sessions.date)),
];

const classFilter = (filter: ClassFilter) => [
  filter.branchId ? eq(classes.branchId, filter.branchId) : undefined,
  filter.termId ? eq(classes.termId, filter.termId) : undefined,
  filter.courseId ? eq(classes.courseId, filter.courseId) : undefined,
  filter.gradeLevelId ? eq(classes.gradeLevelId, filter.gradeLevelId) : undefined,
  filter.teacherId ? eq(classes.teacherMembershipId, filter.teacherId) : undefined,
  filter.roomId ? eq(classes.roomId, filter.roomId) : undefined,
];

/** A session later than the local moment: it hasn't started. */
const upcoming = (moment: LocalMoment) =>
  or(
    gt(sessions.date, moment.date),
    and(eq(sessions.date, moment.date), gt(sessions.startTime, moment.time)),
  );

// ── Classes ─────────────────────────────────────────────────────────────────

/** What one page of the list is read by: the filter, the reach, and where the page starts. */
const pageConditions = (afterId: string | undefined, filter: ClassFilter, reach: Reach) => [
  ...classFilter(filter),
  ...reachConditions(reach),
  afterId ? gt(classes.id, afterId) : undefined,
];

/**
 * Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. A
 * caller limited to some branches or classes gets their page from those, not from every class in
 * the org.
 */
export function listClasses(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: ClassFilter,
  reach: Reach,
  extras: Extras,
) {
  return ctx.db
    .select(classShown(extras))
    .from(classes)
    .where(inOrg(ctx, classes, ...pageConditions(afterId, filter, reach)))
    .orderBy(asc(classes.id))
    .limit(limit + 1);
}

/** One class as it is shown, with its extras: `findClass` for an answer. */
export function findClassShown(ctx: OrgCtx, id: string, reach: Reach, extras: Extras) {
  return ctx.db
    .select(classShown(extras))
    .from(classes)
    .where(inOrg(ctx, classes, eq(classes.id, id), within(reach)))
    .get();
}

/**
 * The classes on that page, as ids: the first `limit` of the same conditions in the same order.
 * It lets the page's weekly slots be read in the same stage as the page.
 */
export function classesOnPage(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: ClassFilter,
  reach: Reach,
): IdQuery {
  return firstIds(
    idsFrom(ctx, classes, classes.id, ...pageConditions(afterId, filter, reach)),
    limit,
    asc(classes.id),
  );
}

export function findClass(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(classes)
    .where(inOrg(ctx, classes, eq(classes.id, id), within(reach)))
    .get();
}

/**
 * The term, course or branch of one class, as ids: what another module reads of it in the same
 * stage as the class, before the class's row is in hand. A class with no term gives no term.
 */
export function ofClass(
  ctx: OrgCtx,
  id: string,
  column: 'termId' | 'courseId' | 'branchId',
): IdQuery {
  return idsFrom(ctx, classes, classes[column], eq(classes.id, id));
}

/**
 * Every class within reach, as ids to filter another table by. A teacher's or a parent's are a
 * few. The classes of some branches are `wide`: a statement checks its rows against them and
 * never reads them all.
 */
export function classesWithin(ctx: OrgCtx, reach: Reach): IdQuery {
  const ids = idsFrom(ctx, classes, classes.id, ...reachConditions(reach));
  return fewClasses(reach) ? ids : wide(ids);
}

/** What a record that points at a class shows of it. */
export function classLabels(ctx: OrgCtx, ids: Ids) {
  return ctx.db
    .select({
      id: classes.id,
      name: classes.name,
      courseId: classes.courseId,
      branchId: classes.branchId,
    })
    .from(classes)
    .where(inOrg(ctx, classes, inIds(classes.id, ids)));
}

/**
 * The classes one invoice run bills: a term's classes, or the classes with no term that run at
 * some point in the dates given.
 */
export function classesBilledIn(ctx: OrgCtx, period: { termId: string } | DateRange) {
  return ctx.db
    .select({
      id: classes.id,
      courseId: classes.courseId,
      termId: classes.termId,
      branchId: classes.branchId,
    })
    .from(classes)
    .where(
      'termId' in period
        ? inOrg(ctx, classes, eq(classes.termId, period.termId))
        : inOrg(
            ctx,
            classes,
            isNull(classes.termId),
            lte(classes.startDate, period.endDate),
            or(isNull(classes.endDate), gte(classes.endDate, period.startDate)),
          ),
    );
}

/** How many classes use a course, term, branch or room. None of those can be deleted while any do. */
export async function countClasses(ctx: OrgCtx, filter: ClassFilter) {
  const row = await ctx.db
    .select({ n: count() })
    .from(classes)
    .where(inOrg(ctx, classes, ...classFilter(filter)))
    .get();
  return row?.n ?? 0;
}

/** A class's term as the unique index on names holds it: "no term" is ''. */
const termKey = (table: { termId: SQLiteColumn }) =>
  sql`(case when ${table.termId} is null then '' else ${table.termId} end)`;

/** Case-insensitive, among the course's classes in the same term and branch that aren't deleted. */
export async function classNameTaken(
  ctx: OrgCtx,
  key: Pick<ClassRow, 'courseId' | 'termId' | 'branchId' | 'name'>,
  exceptId?: string,
) {
  const row = await ctx.db
    .select({ id: classes.id })
    .from(classes)
    .where(
      inOrg(
        ctx,
        classes,
        eq(classes.courseId, key.courseId),
        // The term as the unique index holds it, so this is one lookup in it.
        sql`${termKey(classes)} = ${key.termId ?? ''}`,
        eq(classes.branchId, key.branchId),
        sql`lower(${classes.name}) = lower(${key.name})`,
        exceptId ? ne(classes.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * Whether another class of this class's course, term and branch has the name. Those three come
 * from the class's own row inside the statement, so this can be sent together with the read of
 * the class. The other class is still found by one lookup in the unique index.
 */
export async function otherClassHasName(ctx: OrgCtx, id: string, name: string) {
  const self = alias(classes, 'self');
  const row = await ctx.db
    .select({ id: classes.id })
    .from(self)
    .innerJoin(
      classes,
      inOrg(
        ctx,
        classes,
        eq(classes.courseId, self.courseId),
        sql`${termKey(classes)} = ${termKey(self)}`,
        eq(classes.branchId, self.branchId),
        sql`lower(${classes.name}) = lower(${name})`,
        ne(classes.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
  return row !== undefined;
}

/** Returns the class as stored, from the same batch, so the caller doesn't read it back. */
export async function insertClass(
  ctx: OrgCtx,
  row: NewClassRow & { id: string },
): Promise<ClassRow> {
  const [, inserted] = await writeWithAudit(ctx, [ctx.db.insert(classes).values(row).returning()], {
    action: 'class.created',
    entityType: 'class',
    entityId: row.id,
    after: row,
  });
  const stored = (inserted as ClassRow[])[0];
  if (!stored) throw new Error('Class missing after insert');
  return stored;
}

/**
 * Updates the class and, in the same batch, its upcoming sessions: `restaff` gives those still
 * scheduled the class's new room and teacher, and `plan` adds and removes sessions after a
 * change of dates. Returns the class as updated, from that batch: undefined if it was deleted in
 * the meantime.
 */
export async function updateClass(
  ctx: OrgCtx,
  before: ClassRow,
  changes: ClassChanges,
  sessionChanges?: {
    from: LocalMoment;
    restaff?: Pick<ClassRow, 'roomId' | 'teacherMembershipId'>;
    plan?: SessionPlan;
  },
): Promise<ClassRow | undefined> {
  const { from, restaff, plan } = sessionChanges ?? {};
  const changed = changedFields(before, changes);
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(classes)
        .set(changes)
        .where(inOrg(ctx, classes, eq(classes.id, before.id)))
        .returning(),
      ...(from && restaff
        ? [
            ctx.db
              .update(sessions)
              .set(restaff)
              .where(
                inOrg(
                  ctx,
                  sessions,
                  eq(sessions.classId, before.id),
                  eq(sessions.status, 'scheduled'),
                  upcoming(from),
                ),
              ),
          ]
        : []),
      ...(plan ? sessionStatements(ctx, plan) : []),
    ],
    {
      action: 'class.updated',
      entityType: 'class',
      entityId: before.id,
      before: changed.before,
      after: plan
        ? {
            ...changed.after,
            sessionsAdded: plan.add.length,
            sessionsRemoved: plan.removeIds.length,
          }
        : changed.after,
    },
  );
  return (updated as ClassRow[])[0];
}

/** Soft-deletes the class with its weekly slots and every one of its sessions. */
export async function softDeleteClass(ctx: OrgCtx, before: ClassRow) {
  const deletedAt = now();
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(classes)
        .set({ deletedAt })
        .where(inOrg(ctx, classes, eq(classes.id, before.id))),
      ctx.db
        .update(classSchedules)
        .set({ deletedAt })
        .where(inOrg(ctx, classSchedules, eq(classSchedules.classId, before.id))),
      ctx.db
        .update(sessions)
        .set({ deletedAt })
        .where(inOrg(ctx, sessions, eq(sessions.classId, before.id))),
    ],
    { action: 'class.deleted', entityType: 'class', entityId: before.id, before },
  );
}

// ── Weekly slots ────────────────────────────────────────────────────────────

/** The weekly slots of the given classes, each class's in weekday then start-time order. */
export function listSlots(ctx: OrgCtx, classIds: Ids) {
  return ctx.db
    .select()
    .from(classSchedules)
    .where(inOrg(ctx, classSchedules, inIds(classSchedules.classId, classIds)))
    .orderBy(
      asc(classSchedules.classId),
      asc(classSchedules.weekday),
      asc(classSchedules.startTime),
    );
}

/**
 * Applies a schedule change as one batch with one audit row: replaces the class's weekly slots
 * (`slots: null` leaves them as they are) and adds and removes the sessions in `plan`.
 */
export async function setSchedule(
  ctx: OrgCtx,
  classId: string,
  before: SlotRow[],
  slots: (NewSlotRow & { id: string })[] | null,
  plan: SessionPlan,
) {
  const slotOf = (s: Pick<SlotRow, 'weekday' | 'startTime' | 'endTime'>) => ({
    weekday: s.weekday,
    startTime: s.startTime,
    endTime: s.endTime,
  });
  await writeWithAudit(
    ctx,
    [
      ...(slots
        ? [
            ctx.db
              .update(classSchedules)
              .set({ deletedAt: now() })
              .where(inOrg(ctx, classSchedules, eq(classSchedules.classId, classId))),
            ...chunks(slots, SLOTS_PER_INSERT).map((rows) =>
              ctx.db.insert(classSchedules).values(rows),
            ),
          ]
        : []),
      ...sessionStatements(ctx, plan),
    ],
    {
      action: 'class.schedule_set',
      entityType: 'class',
      entityId: classId,
      before: { slots: before.map(slotOf) },
      after: {
        slots: (slots ?? before).map(slotOf),
        sessionsAdded: plan.add.length,
        sessionsRemoved: plan.removeIds.length,
      },
    },
  );
}

/**
 * The org's open-ended classes still running on `today`, for the daily cron to extend their
 * sessions (TUI-68).
 */
export function openEndedClasses(ctx: OrgCtx, today: string) {
  return ctx.db
    .select()
    .from(classes)
    .where(
      inOrg(
        ctx,
        classes,
        isNull(classes.termId),
        sql`${classes.startDate} is not null`,
        or(isNull(classes.endDate), gte(classes.endDate, today)),
      ),
    );
}

/** The daily cron's sessions for an open-ended class, in one batch with one audit row. */
export async function extendSessions(ctx: OrgCtx, classId: string, plan: SessionPlan) {
  await writeWithAudit(ctx, sessionStatements(ctx, plan), {
    action: 'class.sessions_extended',
    entityType: 'class',
    entityId: classId,
    after: { sessionsAdded: plan.add.length, sessionsRemoved: plan.removeIds.length },
  });
}

// ── Sessions ────────────────────────────────────────────────────────────────

/** Removals first: a replaced session frees its (class, date, start time) for the new one. */
function sessionStatements(ctx: OrgCtx, plan: SessionPlan): BatchItem<'sqlite'>[] {
  return [
    ...(plan.removeIds.length
      ? [
          ctx.db
            .update(sessions)
            .set({ deletedAt: now() })
            .where(inOrg(ctx, sessions, inIds(sessions.id, plan.removeIds))),
        ]
      : []),
    ...chunks(plan.add, SESSIONS_PER_INSERT).map((rows) => ctx.db.insert(sessions).values(rows)),
  ];
}

/** Every session of the class that hasn't started, whatever its status. */
export function upcomingSessions(ctx: OrgCtx, classId: string, from: LocalMoment) {
  return ctx.db
    .select()
    .from(sessions)
    .where(inOrg(ctx, sessions, eq(sessions.classId, classId), upcoming(from)));
}

/**
 * The dates of these classes' lessons in the range, in order: scheduled sessions only. A class
 * with two lessons on one day has that date twice.
 */
export function lessonDates(ctx: OrgCtx, classIds: Ids, range: DateRange) {
  return ctx.db
    .select({ classId: sessions.classId, date: sessions.date })
    .from(sessions)
    .where(
      inOrg(
        ctx,
        sessions,
        inIds(sessions.classId, classIds),
        eq(sessions.status, 'scheduled'),
        gte(sessions.date, range.startDate),
        lte(sessions.date, range.endDate),
      ),
    )
    .orderBy(asc(sessions.date), asc(sessions.startTime), asc(sessions.id));
}

/**
 * What a class or lesson shows of other modules, as values worked out inside the statement that
 * reads it, from the row's own columns. The service builds them from those modules (D-104).
 */
export type Labels = {
  teacherName: (membershipId: SQLiteColumn) => SQL<string | null>;
  roomName: (roomId: SQLiteColumn) => SQL<string | null>;
};
/** What a class shows beside its own row: its teacher's and room's names and the places taken. */
export type Extras = { labels: Labels; placesTaken: (classId: SQLiteColumn) => SQL<number> };

// A class is read for an answer with its extras, worked out for each row the page returns.
const classShown = ({ labels, placesTaken }: Extras) => ({
  class: classes,
  teacherName: labels.teacherName(classes.teacherMembershipId),
  roomName: labels.roomName(classes.roomId),
  enrolledCount: placesTaken(classes.id),
});

/** How many students are marked each way at the session in the column. Left out for parents. */
export type Marks = (sessionId: SQLiteColumn, status: AttendanceStatus) => SQL<number>;

const noMarks = sql<number | null>`null`;

// A session is read with what a timetable needs from its class, its teacher's and room's names,
// and, for staff, how many students are marked each way.
const sessionWithClass = (labels: Labels, marks: Marks | undefined) => ({
  session: sessions,
  className: classes.name,
  courseId: classes.courseId,
  branchId: classes.branchId,
  teacherName: labels.teacherName(sessions.teacherMembershipId),
  roomName: labels.roomName(sessions.roomId),
  present: marks ? marks(sessions.id, 'present') : noMarks,
  late: marks ? marks(sessions.id, 'late') : noMarks,
  absent: marks ? marks(sessions.id, 'absent') : noMarks,
  excused: marks ? marks(sessions.id, 'excused') : noMarks,
});

/** In date, start-time, then id order. Fetches `limit + 1` rows to tell if there's another page. */
export function listSessions(
  ctx: OrgCtx,
  limit: number,
  cursor: SessionCursor | undefined,
  filter: SessionFilter,
  reach: Reach,
  labels: Labels,
  marks: Marks | undefined,
) {
  const after = cursor
    ? or(
        gt(sessions.date, cursor.date),
        and(eq(sessions.date, cursor.date), gt(sessions.startTime, cursor.time)),
        and(
          eq(sessions.date, cursor.date),
          eq(sessions.startTime, cursor.time),
          gt(sessions.id, cursor.id),
        ),
      )
    : undefined;
  return ctx.db
    .select(sessionWithClass(labels, marks))
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(
      and(
        inOrg(
          ctx,
          sessions,
          gte(sessions.date, filter.from),
          lte(sessions.date, filter.to),
          filter.roomId ? eq(sessions.roomId, filter.roomId) : undefined,
          filter.teacherId ? eq(sessions.teacherMembershipId, filter.teacherId) : undefined,
          filter.classId ? eq(sessions.classId, filter.classId) : undefined,
          ...(filter.enrolled ? enrolledIn(filter.enrolled) : []),
          sessionReach(ctx, reach),
          after,
        ),
        inOrg(
          ctx,
          classes,
          ...classFilter({ branchId: filter.branchId, gradeLevelId: filter.gradeLevelId }),
          within(reach),
        ),
      ),
    )
    .orderBy(asc(sessions.date), asc(sessions.startTime), asc(sessions.id))
    .limit(limit + 1);
}

export function findSession(
  ctx: OrgCtx,
  id: string,
  reach: Reach,
  labels: Labels,
  marks: Marks | undefined,
) {
  return ctx.db
    .select(sessionWithClass(labels, marks))
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(and(inOrg(ctx, sessions, eq(sessions.id, id)), inOrg(ctx, classes, within(reach))))
    .get();
}

/**
 * Scheduled sessions that haven't started, on dates a holiday closes: in every branch, or only
 * the holiday's own.
 */
function closedBy(
  ctx: OrgCtx,
  holiday: DateRange & { branchId: string | null },
  from: LocalMoment,
) {
  return inOrg(
    ctx,
    sessions,
    eq(sessions.status, 'scheduled'),
    gte(sessions.date, holiday.startDate),
    lte(sessions.date, holiday.endDate),
    upcoming(from),
    holiday.branchId
      ? sql`${sessions.classId} in (select ${classes.id} from ${classes} where ${classes.orgId} = ${ctx.orgId} and ${classes.branchId} = ${holiday.branchId})`
      : undefined,
  );
}

export async function countSessionsClosedBy(
  ctx: OrgCtx,
  holiday: DateRange & { branchId: string | null },
  from: LocalMoment,
) {
  const row = await ctx.db
    .select({ n: count() })
    .from(sessions)
    .where(closedBy(ctx, holiday, from))
    .get();
  return row?.n ?? 0;
}

/** The statement that removes them, for the caller to run in its own batch. */
export function removeSessionsClosedBy(
  ctx: OrgCtx,
  holiday: DateRange & { branchId: string | null },
  from: LocalMoment,
): BatchItem<'sqlite'> {
  return ctx.db
    .update(sessions)
    .set({ deletedAt: now() })
    .where(closedBy(ctx, holiday, from));
}

// ── Clashes (TUI-50) ────────────────────────────────────────────────────────

/** What finds the scheduled sessions in the dates, within reach: the clash check reads them. */
const clashConditions = (
  ctx: OrgCtx,
  range: DateRange,
  branchId: string | undefined,
  reach: Reach,
) => ({
  ofSession: [
    eq(sessions.status, 'scheduled'),
    gte(sessions.date, range.startDate),
    lte(sessions.date, range.endDate),
    sessionReach(ctx, reach),
  ],
  ofClass: [branchId ? eq(classes.branchId, branchId) : undefined, within(reach)],
});

/** The scheduled sessions in the dates within reach, each with its class's name, course and grade. */
export function sessionsToCheck(
  ctx: OrgCtx,
  range: DateRange,
  branchId: string | undefined,
  reach: Reach,
) {
  const { ofSession, ofClass } = clashConditions(ctx, range, branchId, reach);
  return ctx.db
    .select({
      id: sessions.id,
      classId: sessions.classId,
      roomId: sessions.roomId,
      teacherMembershipId: sessions.teacherMembershipId,
      date: sessions.date,
      startTime: sessions.startTime,
      endTime: sessions.endTime,
      className: classes.name,
      courseId: classes.courseId,
      branchId: classes.branchId,
      gradeLevelId: classes.gradeLevelId,
    })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(and(inOrg(ctx, sessions, ...ofSession), inOrg(ctx, classes, ...ofClass)))
    .orderBy(asc(sessions.date), asc(sessions.startTime), asc(sessions.id));
}

/** The classes of those sessions, as ids: their enrolments are read by them in the same stage. */
export function classesToCheck(
  ctx: OrgCtx,
  range: DateRange,
  branchId: string | undefined,
  reach: Reach,
): IdQuery {
  const { ofSession, ofClass } = clashConditions(ctx, range, branchId, reach);
  return idsFrom(
    ctx,
    classes,
    classes.id,
    ...ofClass,
    inIds(classes.id, idsFrom(ctx, sessions, sessions.classId, ...ofSession)),
  );
}

/** The classes of these courses, or taught by these members, as ids to filter by (TUI-69). */
export function classesOf(
  ctx: OrgCtx,
  by: { courseIds?: Ids; teacherMembershipIds?: string[] },
): IdQuery {
  return idsFrom(
    ctx,
    classes,
    classes.id,
    by.courseIds ? inIds(classes.courseId, by.courseIds) : undefined,
    by.teacherMembershipIds
      ? inIds(classes.teacherMembershipId, by.teacherMembershipIds)
      : undefined,
  );
}

// ── One lesson changed by hand (TUI-49) ─────────────────────────────────────

export type SessionChanges = Partial<
  Pick<
    NewSessionRow,
    | 'date'
    | 'startTime'
    | 'endTime'
    | 'roomId'
    | 'teacherMembershipId'
    | 'status'
    | 'originalDate'
    | 'originalStartTime'
  >
>;

/**
 * Changes one lesson, with its audit row. It holds only while the lesson is as read, so a second
 * change racing this one changes nothing and the caller answers 409. Returns the lesson as
 * changed, from the same batch.
 */
export async function updateSession(
  ctx: OrgCtx,
  before: SessionRow,
  changes: SessionChanges,
  action: string,
) {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(sessions)
        .set({ ...changes, updatedAt: now() })
        .where(
          inOrg(
            ctx,
            sessions,
            eq(sessions.id, before.id),
            eq(sessions.updatedAt, before.updatedAt),
          ),
        )
        .returning(),
    ],
    {
      action,
      entityType: 'session',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as SessionRow[])[0];
}

/** Whether an error is the unique index refusing a second lesson at one date and time. */
export function sessionTaken(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (
      e.message.includes('sessions_org_class_date_start_uq') ||
      e.message.includes('sessions.start_time')
    ) {
      return true;
    }
  }
  return false;
}

// ── The dashboard (TUI-62) ──────────────────────────────────────────────────

/** How many classes within reach run on or after a date: their own end, else their term's. */
export async function countRunningClasses(ctx: OrgCtx, reach: Reach, date: string, terms: IdQuery) {
  const row = await ctx.db
    .select({ n: count() })
    .from(classes)
    .where(
      inOrg(
        ctx,
        classes,
        or(
          gte(classes.endDate, date),
          and(isNull(classes.endDate), isNull(classes.termId)),
          and(isNull(classes.endDate), inIds(classes.termId, terms)),
        ),
        within(reach),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** The lessons within reach in the dates, both included: id, date and status. */
export function lessonsBetween(ctx: OrgCtx, range: DateRange, reach: Reach) {
  return ctx.db
    .select({ id: sessions.id, date: sessions.date, status: sessions.status })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(
      and(
        inOrg(
          ctx,
          sessions,
          gte(sessions.date, range.startDate),
          lte(sessions.date, range.endDate),
          sessionReach(ctx, reach),
        ),
        inOrg(ctx, classes, within(reach)),
      ),
    );
}

/** Those lessons, scheduled ones only, as ids: their marks are read by them in the same stage. */
export function scheduledBetween(ctx: OrgCtx, range: DateRange, reach: Reach): IdQuery {
  return idsFrom(
    ctx,
    sessions,
    sessions.id,
    eq(sessions.status, 'scheduled'),
    gte(sessions.date, range.startDate),
    lte(sessions.date, range.endDate),
    sessionReach(ctx, reach),
    reach.branchIds ? inIds(sessions.classId, classesWithin(ctx, reach)) : undefined,
  );
}

/** The classes running on or after a date, with what a public form shows of them (TUI-47). */
export function runningClasses(ctx: OrgCtx, date: string, terms: IdQuery) {
  const running = or(
    gte(classes.endDate, date),
    and(isNull(classes.endDate), isNull(classes.termId)),
    and(isNull(classes.endDate), inIds(classes.termId, terms)),
  );
  return ctx.db
    .select({
      id: classes.id,
      name: classes.name,
      branchId: classes.branchId,
      courseId: classes.courseId,
      gradeLevelId: classes.gradeLevelId,
      startDate: classes.startDate,
      endDate: classes.endDate,
    })
    .from(classes)
    .where(inOrg(ctx, classes, running))
    .orderBy(asc(classes.id));
}

/** Those classes, as ids: their weekly slots are read beside them. */
export function runningClassIds(ctx: OrgCtx, date: string, terms: IdQuery): IdQuery {
  return idsFrom(
    ctx,
    classes,
    classes.id,
    or(
      gte(classes.endDate, date),
      and(isNull(classes.endDate), isNull(classes.termId)),
      and(isNull(classes.endDate), inIds(classes.termId, terms)),
    ),
  );
}

/** The org's sessions on or after `date`, as a wide query (D-104). */
export function sessionsSince(ctx: OrgCtx, date: string): IdQuery {
  return wide(idsFrom(ctx, sessions, sessions.id, gte(sessions.date, date)));
}
