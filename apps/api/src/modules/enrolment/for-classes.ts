// What the classes module filters sessions by for one student's timetable. Both are queries for
// class ids, written into the statement that reads the sessions, so the timetable costs no trip
// before that read (D-104).

import { enrolments } from '@edustrux/db';
import { eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { idsFrom, type IdQuery, type OrgCtx } from '../../db/scope';

export type Timetable = {
  /** The classes the student holds an active enrolment in. */
  classes: IdQuery;
  /**
   * Of those, the classes whose enrolment covers `date`: the date column of the row being
   * filtered. It is worked out for each row, so it can only narrow what `classes` finds.
   */
  coveredOn: (date: SQLiteColumn) => IdQuery;
};

/** The classes a student is enrolled in, and on which dates each enrolment covers them. */
export function timetableOf(ctx: OrgCtx, studentId: string): Timetable {
  const active = [eq(enrolments.studentId, studentId), eq(enrolments.status, 'active')];
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
