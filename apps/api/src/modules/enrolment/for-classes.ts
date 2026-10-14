// What the classes module filters sessions by for a timetable: one student's, or a parent's
// children's (D-126). Both are queries for class ids, written into the statement that reads the
// sessions, so the timetable costs no trip before that read (D-104).

import { enrolments } from '@edustrux/db';
import { eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { idsFrom, inIds, type IdQuery, type Ids, type OrgCtx } from '../../db/scope';

export type Timetable = {
  /** The classes the students hold an active enrolment in. */
  classes: IdQuery;
  /**
   * Of those, the classes whose enrolment covers `date`: the date column of the row being
   * filtered. It is worked out for each row, so it can only narrow what `classes` finds.
   */
  coveredOn: (date: SQLiteColumn) => IdQuery;
};

/**
 * The classes a student is enrolled in, and on which dates each enrolment covers them. Given
 * several students (a parent's children), the classes any of them is enrolled in, on the dates
 * one of their enrolments covers.
 */
export function timetableOf(ctx: OrgCtx, students: string | Ids): Timetable {
  const active = [
    typeof students === 'string'
      ? eq(enrolments.studentId, students)
      : inIds(enrolments.studentId, students),
    eq(enrolments.status, 'active'),
  ];
  return {
    classes: idsFrom(ctx, enrolments, enrolments.classId, ...active),
    coveredOn: (date) =>
      idsFrom(
        ctx,
        enrolments,
        enrolments.classId,
        ...active,
        lte(enrolments.startDate, date),
        or(isNull(enrolments.endDate), gte(enrolments.endDate, date)),
      ),
  };
}
