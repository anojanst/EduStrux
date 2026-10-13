import { attendance, now } from '@edustrux/db';
import type { AttendanceStatus } from '@edustrux/shared';
import { eq, sql } from 'drizzle-orm';
import { idsFrom, inIds, inOrg, writeWithAudit, type IdQuery, type OrgCtx } from '../../db/scope';

export type AttendanceRow = typeof attendance.$inferSelect;
export type NewAttendanceRow = typeof attendance.$inferInsert;

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
      ...inserts,
    ],
    {
      action: 'attendance.marked',
      entityType: 'session',
      entityId: sessionId,
      before: { records: change.before },
      after: { records: change.after },
    },
  );
  // The batch answers in the order it was sent, so the inserts' rows are its last results.
  if (inserts.length === 0) return [];
  return (results.slice(-inserts.length) as SavedMark[][]).flat();
}
