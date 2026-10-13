import { academicYears } from '@edustrux/db';
import { localNow } from '@edustrux/shared';
import { asc, sql } from 'drizzle-orm';
import { firstIds, idsFrom, type IdQuery, type OrgCtx } from '../../db/scope';
import * as orgs from '../orgs/service';

// What the people module needs of the calendar inside its own statements. It is a file of its
// own so the calendar's service can change without touching it (TUI-95).

/**
 * The current academic year, as a query for its id: written into the statement that filters by
 * it, so the years aren't read first (D-104). No id when the org has no academic years.
 *
 * It is the rule `academicYears()` in the calendar service applies to the rows it has read: the
 * year today falls in (in the org's timezone); between years, the one that ended last; before
 * the first year, that first one. The two must give the same year, and
 * `apps/api/test/people.test.ts` checks that they do in each of those cases.
 */
export async function currentAcademicYear(ctx: OrgCtx): Promise<IdQuery> {
  const { timezone } = await orgs.getOrg(ctx);
  const today = localNow(timezone).date;
  const { startDate, endDate, id } = academicYears;
  const ended = sql`${endDate} < ${today}`;
  return firstIds(
    idsFrom(ctx, academicYears, id),
    1,
    // The year today falls in, then the years that have ended, then the ones still to start.
    sql`case when ${startDate} <= ${today} and ${endDate} >= ${today} then 0 when ${ended} then 1 else 2 end`,
    // Of the years that have ended, the last. These are null for every other year.
    sql`case when ${ended} then ${startDate} end desc`,
    sql`case when ${ended} then ${id} end desc`,
    // Of the years still to start, the first.
    asc(startDate),
    asc(id),
  );
}
