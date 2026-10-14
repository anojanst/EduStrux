import { enrolments } from '@edustrux/db';
import { eq } from 'drizzle-orm';
import { inIds, inOrg, type Ids, type OrgCtx } from '../../db/scope';

// What attendance asks of enrolment so that it can read a session and its roster in one stage
// (TUI-89). It is in a file of its own only because this module's service and repository were
// being rewritten by another task at the same time. Once both have merged, fold it in:
// `activeSpansIn` into repository.ts, and `studentsExpectedIn` into service.ts in place of
// `studentIdsExpected`, which nothing calls any more (nor `activeStudentIdsOn` under it).

/** One active enrolment: its student and the dates (both included) it covers. */
type Span = { studentId: string; startDate: string; endDate: string | null };

/** The active enrolments in these classes, each with the dates it covers. */
function activeSpansIn(ctx: OrgCtx, classIds: Ids) {
  return ctx.db
    .select({
      studentId: enrolments.studentId,
      startDate: enrolments.startDate,
      endDate: enrolments.endDate,
    })
    .from(enrolments)
    .where(
      inOrg(ctx, enrolments, inIds(enrolments.classId, classIds), eq(enrolments.status, 'active')),
    );
}

/** Whether an enrolment covers a date: it has started by then and hasn't ended before it. */
const covers = (span: Span, date: string) =>
  span.startDate <= date && (span.endDate === null || span.endDate >= date);

/**
 * Who is expected at these classes' lessons: the students whose active enrolment covers the
 * lesson's date. The answer is a function of that date, so it can be asked for before the date
 * is known, in the same stage as the lesson itself. `classIds` can be a query, such as the class
 * of a session.
 */
export async function studentsExpectedIn(ctx: OrgCtx, classIds: Ids) {
  const spans = await activeSpansIn(ctx, classIds);
  return (date: string) => [
    ...new Set(spans.filter((span) => covers(span, date)).map((span) => span.studentId)),
  ];
}
