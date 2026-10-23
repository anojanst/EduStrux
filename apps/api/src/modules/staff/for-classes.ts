// What the classes module shows of a teacher beside a class or lesson: their name, read by the
// row's own membership id inside the statement that reads the class, so it costs no trip (D-104).

import { memberships, users } from '@edustrux/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { OrgCtx } from '../../db/scope';

/**
 * The name of the member in `membershipId`, the membership id column of the row being read, or
 * their email when no name is set. A member who has since left keeps their name on what they
 * taught. null = none.
 */
export function memberNameOf(ctx: OrgCtx, membershipId: SQLiteColumn): SQL<string | null> {
  // Each part is built on its own so its columns keep their table's name inside the subquery.
  const name = sql`coalesce(${users.name}, ${users.email})`;
  const member = and(eq(memberships.orgId, ctx.orgId), eq(memberships.id, membershipId));
  const user = eq(users.id, memberships.userId);
  return sql<
    string | null
  >`(select ${name} from ${memberships} inner join ${users} on ${user} where ${member})`;
}
