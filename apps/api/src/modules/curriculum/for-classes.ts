// What the classes module reads of the curriculum in the same stage as a class, before it has
// the class's row. It gives the ids as a query, "this class's course", which is written into the
// statement here and costs no trip of its own (D-104).

import { courses } from '@edustrux/db';
import { inIds, inOrg, type Ids, type OrgCtx } from '../../db/scope';

/** The lesson length of the courses with these ids. null = the course has none. */
export function lessonLengths(ctx: OrgCtx, courseIds: Ids) {
  return ctx.db
    .select({ id: courses.id, durationMinutes: courses.durationMinutes })
    .from(courses)
    .where(inOrg(ctx, courses, inIds(courses.id, courseIds)));
}
