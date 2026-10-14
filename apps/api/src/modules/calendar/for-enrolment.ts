import { terms } from '@edustrux/db';
import { inIds, inOrg, type Ids, type OrgCtx } from '../../db/scope';

// What enrolling a student reads of the calendar, through the classes module, in the same stage
// as the class (TUI-94). It is in a file of its own only because the calendar's service and
// repository were being rewritten by another task at the same time. TUI-96 adds the same read
// as `termDates` in `for-classes.ts`: once both have merged, keep one, in repository.ts, behind
// a service function that takes ids.

/**
 * The dates of the terms with these ids. `termIds` can be a query, such as "this class's term",
 * which is written into the statement and costs no trip of its own (D-104).
 */
export function termDates(ctx: OrgCtx, termIds: Ids) {
  return ctx.db
    .select({ id: terms.id, startDate: terms.startDate, endDate: terms.endDate })
    .from(terms)
    .where(inOrg(ctx, terms, inIds(terms.id, termIds)));
}
