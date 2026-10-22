// What the classes module reads of the calendar in the same stage as a class, before it has the
// class's row. It gives the ids as a query, "this class's term" or "this class's branch", which
// is written into the statement here and costs no trip of its own (D-104).

import { holidays, terms } from '@edustrux/db';
import { gte, isNull, or } from 'drizzle-orm';
import { idsFrom, inIds, inOrg, type IdQuery, type Ids, type OrgCtx } from '../../db/scope';

/** The dates of the terms with these ids. */
export function termDates(ctx: OrgCtx, termIds: Ids) {
  return ctx.db
    .select({ id: terms.id, startDate: terms.startDate, endDate: terms.endDate })
    .from(terms)
    .where(inOrg(ctx, terms, inIds(terms.id, termIds)));
}

/**
 * Every holiday that closes one of these branches on `from` or later, organisation-wide ones
 * included. There is no last date: the caller doesn't know yet how far ahead it will look.
 */
export function closedFrom(ctx: OrgCtx, branchIds: Ids, from: string) {
  return ctx.db
    .select({ startDate: holidays.startDate, endDate: holidays.endDate })
    .from(holidays)
    .where(
      inOrg(
        ctx,
        holidays,
        gte(holidays.endDate, from),
        or(isNull(holidays.branchId), inIds(holidays.branchId, branchIds)),
      ),
    );
}

/** The terms that end on or after a date, as ids to filter classes by (TUI-62). */
export function termsRunningFrom(ctx: OrgCtx, date: string): IdQuery {
  return idsFrom(ctx, terms, terms.id, gte(terms.endDate, date));
}
