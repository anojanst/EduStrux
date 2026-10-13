import { attendance, now } from '@edustrux/db';
import type { AttendanceStatus } from '@edustrux/shared';
import { eq, sql } from 'drizzle-orm';
import { inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type AttendanceRow = typeof attendance.$inferSelect;
export type NewAttendanceRow = typeof attendance.$inferInsert;

/** One student's status at a session. null = not marked. */
export type Mark = { studentId: string; status: AttendanceStatus | null };

// D1 binds at most 100 values per statement. An attendance row binds 8.
const ROWS_PER_INSERT = 12;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Every mark at the session. */
export function listMarks(ctx: OrgCtx, sessionId: string) {
  return ctx.db
    .select()
    .from(attendance)
    .where(inOrg(ctx, attendance, eq(attendance.sessionId, sessionId)));
}

/**
 * Sets and clears marks at a session as one batch with one audit row. `set` holds a row per
 * student to mark: a student who already has a mark keeps their row and takes its status, so two
 * people marking at once don't collide. `clearIds` are the rows of the marks to remove.
 * `before` and `after` are the statuses that changed, for the audit row.
 */
export async function saveMarks(
  ctx: OrgCtx,
  sessionId: string,
  set: (NewAttendanceRow & { id: string })[],
  clearIds: string[],
  change: { before: Mark[]; after: Mark[] },
) {
  await writeWithAudit(
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
      ...chunks(set, ROWS_PER_INSERT).map((rows) =>
        ctx.db
          .insert(attendance)
          .values(rows)
          .onConflictDoUpdate({
            target: [attendance.orgId, attendance.sessionId, attendance.studentId],
            targetWhere: sql`${attendance.deletedAt} is null`,
            set: { status: sql`excluded.status`, updatedAt: sql`excluded.updated_at` },
          }),
      ),
    ],
    {
      action: 'attendance.marked',
      entityType: 'session',
      entityId: sessionId,
      before: { records: change.before },
      after: { records: change.after },
    },
  );
}
