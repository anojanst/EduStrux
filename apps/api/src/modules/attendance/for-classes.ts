// What the classes module shows of attendance beside a lesson: how many students are marked
// each way, counted by the row's own session id inside the statement that reads the lesson, so
// it costs no trip (D-104).

import { attendance } from '@edustrux/db';
import type { AttendanceStatus } from '@edustrux/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { OrgCtx } from '../../db/scope';

/** How many students are marked `status` at the session in `sessionId`. */
export function marksAt(
  ctx: OrgCtx,
  sessionId: SQLiteColumn,
  status: AttendanceStatus,
): SQL<number> {
  const marked = and(
    eq(attendance.orgId, ctx.orgId),
    eq(attendance.sessionId, sessionId),
    isNull(attendance.deletedAt),
    eq(attendance.status, status),
  );
  return sql<number>`(select count(*) from ${attendance} where ${marked})`;
}
