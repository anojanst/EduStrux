import {
  absenceNotices,
  attendance,
  makeupBookings,
  makeupCredits,
  makeupPolicies,
  now,
} from '@edustrux/db';
import type { AttendanceStatus } from '@edustrux/shared';
import { and, asc, count, desc, eq, gt, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
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

export type AttendanceRow = typeof attendance.$inferSelect;
export type NewAttendanceRow = typeof attendance.$inferInsert;
export type AbsenceNoticeRow = typeof absenceNotices.$inferSelect;
export type NewAbsenceNoticeRow = typeof absenceNotices.$inferInsert;

/** One student's status at a session. null = not marked. */
export type Mark = { studentId: string; status: AttendanceStatus | null };

/** A mark as a write left it: `updatedAt` is when it was made, which a roster shows. */
export type SavedMark = Pick<AttendanceRow, 'studentId' | 'status' | 'updatedAt'>;

// D1 binds at most 100 values per statement. An attendance row binds 8.
const ROWS_PER_INSERT = 12;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const atSession = (sessionId: string) => eq(attendance.sessionId, sessionId);

/** Every mark at the session. */
export function listMarks(ctx: OrgCtx, sessionId: string) {
  return ctx.db
    .select()
    .from(attendance)
    .where(inOrg(ctx, attendance, atSession(sessionId)));
}

/**
 * The students marked at the session, as ids to filter another table by: their names can be
 * read in the same stage as the marks (D-104).
 */
export function studentsMarkedAt(ctx: OrgCtx, sessionId: string): IdQuery {
  return idsFrom(ctx, attendance, attendance.studentId, atSession(sessionId));
}

/**
 * Sets and clears marks at a session as one batch with one audit row. `set` holds a row per
 * student to mark: a student who already has a mark keeps their row and takes its status, so two
 * people marking at once don't collide. `clearIds` are the rows of the marks to remove.
 * `before` and `after` are the statuses that changed, for the audit row.
 *
 * Returns the marks it set as they are now stored, so the caller doesn't read them back.
 */
export async function saveMarks(
  ctx: OrgCtx,
  sessionId: string,
  set: (NewAttendanceRow & { id: string })[],
  clearIds: string[],
  change: { before: Mark[]; after: Mark[] },
  credits: { statements: BatchItem<'sqlite'>[]; added: string[]; withdrawn: string[] } = {
    statements: [],
    added: [],
    withdrawn: [],
  },
): Promise<SavedMark[]> {
  const inserts = chunks(set, ROWS_PER_INSERT).map((rows) =>
    ctx.db
      .insert(attendance)
      .values(rows)
      .onConflictDoUpdate({
        target: [attendance.orgId, attendance.sessionId, attendance.studentId],
        targetWhere: sql`${attendance.deletedAt} is null`,
        set: { status: sql`excluded.status`, updatedAt: sql`excluded.updated_at` },
      })
      .returning({
        studentId: attendance.studentId,
        status: attendance.status,
        updatedAt: attendance.updatedAt,
      }),
  );
  const results = await writeWithAudit(
    ctx,
    [
      ...(clearIds.length
        ? [
            ctx.db
              .update(attendance)
              .set({ deletedAt: now() })
              .where(inOrg(ctx, attendance, inIds(attendance.id, clearIds))),
          ]
        : []),
      ...credits.statements,
      ...inserts,
    ],
    {
      action: 'attendance.marked',
      entityType: 'session',
      entityId: sessionId,
      before: { records: change.before },
      after: {
        records: change.after,
        // The make-up credits the marks earned or took back (TUI-55), by student.
        ...(credits.added.length > 0 ? { creditsEarned: credits.added } : {}),
        ...(credits.withdrawn.length > 0 ? { creditsWithdrawn: credits.withdrawn } : {}),
      },
    },
  );
  // The batch answers in the order it was sent, so the inserts' rows are its last results.
  if (inserts.length === 0) return [];
  return (results.slice(-inserts.length) as SavedMark[][]).flat();
}

// ── Absence notices ─────────────────────────────────────────────────────────

export type NoticeFilter = { studentId?: string; from?: string; to?: string };

/**
 * What one page of notices is read by: the filter, the students the caller reaches (undefined =
 * every student), and where the page starts. A student asked for is the lookup; a teacher's or a
 * parent's students are a few ids, and a branch manager's are `wide`, checked row by row.
 */
const noticePage = (
  afterId: string | undefined,
  filter: NoticeFilter,
  reach: Ids | undefined,
): (SQL | undefined)[] => [
  filter.studentId ? inIds(absenceNotices.studentId, [filter.studentId]) : undefined,
  reach ? inIds(absenceNotices.studentId, reach) : undefined,
  filter.from ? gte(absenceNotices.endDate, filter.from) : undefined,
  filter.to ? lte(absenceNotices.startDate, filter.to) : undefined,
  afterId ? gt(absenceNotices.id, afterId) : undefined,
];

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listNotices(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: NoticeFilter,
  reach: Ids | undefined,
) {
  return ctx.db
    .select()
    .from(absenceNotices)
    .where(inOrg(ctx, absenceNotices, ...noticePage(afterId, filter, reach)))
    .orderBy(asc(absenceNotices.id))
    .limit(limit + 1);
}

/** The students of the notices on that page, so their names are read in the same stage (D-104). */
export function studentsOnNoticePage(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: NoticeFilter,
  reach: Ids | undefined,
): IdQuery {
  return firstIds(
    idsFrom(ctx, absenceNotices, absenceNotices.studentId, ...noticePage(afterId, filter, reach)),
    limit,
    asc(absenceNotices.id),
  );
}

/**
 * The notices of these students that cover `date`, newest first. `date` can be a value another
 * module gives, such as a session's date, so this goes to the database beside that session.
 */
export function noticesOn(ctx: OrgCtx, studentIds: Ids, date: SQL | string) {
  return ctx.db
    .select({
      id: absenceNotices.id,
      studentId: absenceNotices.studentId,
      reason: absenceNotices.reason,
      source: absenceNotices.source,
      createdAt: absenceNotices.createdAt,
    })
    .from(absenceNotices)
    .where(
      inOrg(
        ctx,
        absenceNotices,
        inIds(absenceNotices.studentId, studentIds),
        lte(absenceNotices.startDate, date),
        gte(absenceNotices.endDate, date),
      ),
    )
    .orderBy(desc(absenceNotices.id));
}

export async function insertNotice(ctx: OrgCtx, notice: NewAbsenceNoticeRow & { id: string }) {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(absenceNotices).values(notice).returning()],
    {
      action: 'absence_notice.created',
      entityType: 'absence_notice',
      entityId: notice.id,
      after: notice,
    },
  );
  const row = (inserted as AbsenceNoticeRow[])[0];
  if (!row) throw new Error('Absence notice missing after insert');
  return row;
}

// ── Make-ups (TUI-55) ───────────────────────────────────────────────────────

export type PolicyRow = typeof makeupPolicies.$inferSelect;
export type NewPolicyRow = typeof makeupPolicies.$inferInsert;
export type CreditRow = typeof makeupCredits.$inferSelect;
export type NewCreditRow = typeof makeupCredits.$inferInsert;
export type BookingRow = typeof makeupBookings.$inferSelect;
export type NewBookingRow = typeof makeupBookings.$inferInsert;

// A credit row binds 13 values.
const CREDITS_PER_INSERT = 7;

export function findPolicy(ctx: OrgCtx) {
  return ctx.db.select().from(makeupPolicies).where(inOrg(ctx, makeupPolicies)).get();
}

/** Writes the org's policy, adding its row the first time. Returns it as stored. */
export async function savePolicy(
  ctx: OrgCtx,
  before: PolicyRow | undefined,
  values: Omit<NewPolicyRow, 'id' | 'orgId'>,
  newId: string,
) {
  const statement = before
    ? ctx.db
        .update(makeupPolicies)
        .set({ ...values, updatedAt: now() })
        .where(inOrg(ctx, makeupPolicies, eq(makeupPolicies.id, before.id)))
        .returning()
    : ctx.db
        .insert(makeupPolicies)
        .values({ id: newId, orgId: ctx.orgId, ...values })
        .returning();
  const [, saved] = await writeWithAudit(ctx, [statement], {
    action: 'makeup_policy.updated',
    entityType: 'makeup_policy',
    entityId: before?.id ?? newId,
    ...(before ? changedFields(before, values) : { after: values }),
  });
  return (saved as PolicyRow[])[0]!;
}

/** The credits earned at a lesson, one per student at most. */
export function creditsAt(ctx: OrgCtx, sessionId: string) {
  return ctx.db
    .select()
    .from(makeupCredits)
    .where(inOrg(ctx, makeupCredits, eq(makeupCredits.sessionId, sessionId)));
}

/**
 * Statements for the attendance batch: the credits marks earn, and the unused ones a changed
 * mark takes back. One already used stays: its make-up is booked.
 */
export function creditStatements(
  ctx: OrgCtx,
  add: (NewCreditRow & { id: string })[],
  withdrawIds: string[],
): BatchItem<'sqlite'>[] {
  return [
    ...(withdrawIds.length > 0
      ? [
          ctx.db
            .update(makeupCredits)
            .set({ deletedAt: now() })
            .where(
              inOrg(
                ctx,
                makeupCredits,
                inIds(makeupCredits.id, withdrawIds),
                eq(makeupCredits.status, 'available'),
              ),
            ),
        ]
      : []),
    ...chunks(add, CREDITS_PER_INSERT).map((rows) =>
      ctx.db.insert(makeupCredits).values(rows).onConflictDoNothing(),
    ),
  ];
}

export type CreditFilter = { studentId?: string; status?: string; today: string };

/** What a page of credits is read by. An unused credit past its last day reads as expired. */
const creditPage = (
  afterId: string | undefined,
  filter: CreditFilter,
  reach: Ids | undefined,
): (SQL | undefined)[] => {
  const lapsed = and(
    eq(makeupCredits.status, 'available'),
    sql`${makeupCredits.expiresOn} is not null`,
    lt(makeupCredits.expiresOn, filter.today),
  );
  const status =
    filter.status === 'available'
      ? and(eq(makeupCredits.status, 'available'), sql`not (${lapsed})`)
      : filter.status === 'expired'
        ? sql`(${makeupCredits.status} = 'expired' or ${lapsed})`
        : filter.status === 'used'
          ? eq(makeupCredits.status, 'used')
          : undefined;
  return [
    filter.studentId ? inIds(makeupCredits.studentId, [filter.studentId]) : undefined,
    reach ? inIds(makeupCredits.studentId, reach) : undefined,
    status,
    afterId ? lt(makeupCredits.id, afterId) : undefined,
  ];
};

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listCredits(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: CreditFilter,
  reach: Ids | undefined,
) {
  return ctx.db
    .select()
    .from(makeupCredits)
    .where(inOrg(ctx, makeupCredits, ...creditPage(afterId, filter, reach)))
    .orderBy(desc(makeupCredits.id))
    .limit(limit + 1);
}

/** The students and the bookings of the credits on that page, read in the same stage (D-104). */
export function onCreditPage(
  ctx: OrgCtx,
  column: 'studentId' | 'bookingId',
  limit: number,
  afterId: string | undefined,
  filter: CreditFilter,
  reach: Ids | undefined,
): IdQuery {
  return firstIds(
    idsFrom(ctx, makeupCredits, makeupCredits[column], ...creditPage(afterId, filter, reach)),
    limit,
    desc(makeupCredits.id),
  );
}

/** One credit, if its student is within reach (undefined = every student). */
export function findCredit(ctx: OrgCtx, id: string, reach: Ids | undefined) {
  return ctx.db
    .select()
    .from(makeupCredits)
    .where(
      inOrg(
        ctx,
        makeupCredits,
        eq(makeupCredits.id, id),
        reach ? and(inIds(makeupCredits.studentId, reach)) : undefined,
      ),
    )
    .get();
}

/** These bookings. */
export function listBookings(ctx: OrgCtx, ids: Ids) {
  return ctx.db
    .select()
    .from(makeupBookings)
    .where(inOrg(ctx, makeupBookings, inIds(makeupBookings.id, ids)));
}

/** The bookings into a lesson. */
export function bookingsInto(ctx: OrgCtx, sessionId: string) {
  return ctx.db
    .select()
    .from(makeupBookings)
    .where(inOrg(ctx, makeupBookings, eq(makeupBookings.sessionId, sessionId)));
}

/**
 * The students booked into a lesson, as ids: their names are read beside the roster, and are how
 * the roster knows who is booked. `among` keeps to some students: a parent's children.
 */
export function studentsBookedInto(ctx: OrgCtx, sessionId: string, among?: Ids): IdQuery {
  return idsFrom(
    ctx,
    makeupBookings,
    makeupBookings.studentId,
    eq(makeupBookings.sessionId, sessionId),
    among ? and(inIds(makeupBookings.studentId, among)) : undefined,
  );
}

/** One booking, if its student is within reach. */
export function findBooking(ctx: OrgCtx, id: string, reach: Ids | undefined) {
  return ctx.db
    .select()
    .from(makeupBookings)
    .where(
      inOrg(
        ctx,
        makeupBookings,
        eq(makeupBookings.id, id),
        reach ? and(inIds(makeupBookings.studentId, reach)) : undefined,
      ),
    )
    .get();
}

/**
 * Books the make-up and uses the credit, as one batch with its audit row. The unique indexes
 * refuse a second booking of the credit, or of the student into the lesson, made at the same
 * moment: the batch fails whole.
 */
export async function insertBooking(ctx: OrgCtx, booking: NewBookingRow & { id: string }) {
  const [, inserted] = await writeWithAudit(
    ctx,
    [
      ctx.db.insert(makeupBookings).values(booking).returning(),
      ctx.db
        .update(makeupCredits)
        .set({ status: 'used', bookingId: booking.id })
        .where(inOrg(ctx, makeupCredits, eq(makeupCredits.id, booking.creditId))),
    ],
    { action: 'makeup.booked', entityType: 'makeup_booking', entityId: booking.id, after: booking },
  );
  return (inserted as BookingRow[])[0]!;
}

/** Cancels the booking and gives the credit back. */
export async function cancelBooking(ctx: OrgCtx, before: BookingRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(makeupBookings)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, makeupBookings, eq(makeupBookings.id, before.id))),
      ctx.db
        .update(makeupCredits)
        .set({ status: 'available', bookingId: null })
        .where(inOrg(ctx, makeupCredits, eq(makeupCredits.id, before.creditId))),
    ],
    { action: 'makeup.cancelled', entityType: 'makeup_booking', entityId: before.id, before },
  );
}

/** Whether an error is a unique index refusing a second booking. */
export function bookingTaken(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e.message.includes('makeup_bookings')) return true;
  }
  return false;
}

/**
 * Marks every org's unused credits past their last day as expired, for the hourly cron. `today`
 * is each org's local date, so it is worked out per org by the caller.
 */
export function expireCredits(ctx: OrgCtx, today: string) {
  return ctx.db
    .update(makeupCredits)
    .set({ status: 'expired' })
    .where(
      inOrg(
        ctx,
        makeupCredits,
        eq(makeupCredits.status, 'available'),
        sql`${makeupCredits.expiresOn} is not null`,
        lt(makeupCredits.expiresOn, today),
      ),
    )
    .returning({ id: makeupCredits.id });
}

// ── The dashboard (TUI-62) ──────────────────────────────────────────────────

/** Of these lessons, the ones with any mark. */
export function lessonsMarked(ctx: OrgCtx, sessionIds: Ids) {
  return ctx.db
    .selectDistinct({ sessionId: attendance.sessionId })
    .from(attendance)
    .where(inOrg(ctx, attendance, inIds(attendance.sessionId, sessionIds)));
}

/** How many students within reach have a notice covering the date. */
export async function countAwayOn(ctx: OrgCtx, date: string, reach: Ids | undefined) {
  const row = await ctx.db
    .select({ n: sql<number>`count(distinct ${absenceNotices.studentId})` })
    .from(absenceNotices)
    .where(
      inOrg(
        ctx,
        absenceNotices,
        lte(absenceNotices.startDate, date),
        gte(absenceNotices.endDate, date),
        reach ? and(inIds(absenceNotices.studentId, reach)) : undefined,
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** How many unused credits within reach haven't lapsed by the date. */
export async function countCreditsAvailable(ctx: OrgCtx, date: string, reach: Ids | undefined) {
  const row = await ctx.db
    .select({ n: count() })
    .from(makeupCredits)
    .where(
      inOrg(
        ctx,
        makeupCredits,
        eq(makeupCredits.status, 'available'),
        sql`(${makeupCredits.expiresOn} is null or ${makeupCredits.expiresOn} >= ${date})`,
        reach ? and(inIds(makeupCredits.studentId, reach)) : undefined,
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** Clears the reasons on these students' absence notices, when their family is erased (TUI-79). */
export function eraseStatements(ctx: OrgCtx, studentIds: string[]): BatchItem<'sqlite'>[] {
  if (studentIds.length === 0) return [];
  return [
    ctx.db
      .update(absenceNotices)
      .set({ reason: null })
      .where(and(eq(absenceNotices.orgId, ctx.orgId), inIds(absenceNotices.studentId, studentIds))),
  ];
}

/** Students marked on any of the sessions, as a wide query (D-104). */
export function studentsMarkedIn(ctx: OrgCtx, sessionIds: IdQuery): IdQuery {
  return wide(
    idsFrom(ctx, attendance, attendance.studentId, inIds(attendance.sessionId, sessionIds)),
  );
}

/**
 * Deletes for good what attendance holds on the students, deleted rows too: marks, absence
 * notices, make-up credits and bookings (TUI-118).
 */
export function purgeStatements(ctx: OrgCtx, studentIds: string[]): BatchItem<'sqlite'>[] {
  if (studentIds.length === 0) return [];
  return [attendance, absenceNotices, makeupBookings, makeupCredits].map((table) =>
    ctx.db.delete(table).where(and(eq(table.orgId, ctx.orgId), inIds(table.studentId, studentIds))),
  );
}
