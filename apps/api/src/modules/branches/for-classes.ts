// What the classes module shows of a room beside a class or lesson: its name, read by the row's
// own room id inside the statement that reads the class, so it costs no trip (D-104).

import { rooms } from '@edustrux/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { OrgCtx } from '../../db/scope';

/** The name of the room in `roomId`, the room id column of the row being read. null = none. */
export function roomNameOf(ctx: OrgCtx, roomId: SQLiteColumn): SQL<string | null> {
  // A room in use can't be deleted, so a deleted one is only ever on a lesson that has passed.
  // The key finds the room; `+org_id` only checks it, so SQLite doesn't go by the org (D-100).
  return sql<
    string | null
  >`(select ${rooms.name} from ${rooms} where ${and(eq(rooms.id, roomId), sql`+${rooms.orgId} = ${ctx.orgId}`)})`;
}
