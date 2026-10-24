// What the curriculum module reads of classes inside its own statements: how many classes run
// each course, counted in the statement that lists the courses, so it costs no trip (D-104).

import { classes } from '@edustrux/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { OrgCtx } from '../../db/scope';

/**
 * The classes that run the course in `courseId`, the course id column of the row being read,
 * counted inside that statement. Every class counts, cancelled or ended, as it does when a
 * course is deleted (`countClasses`).
 */
export function classesOfCourse(ctx: OrgCtx, courseId: SQLiteColumn): SQL<number> {
  const running = and(
    eq(classes.orgId, ctx.orgId),
    eq(classes.courseId, courseId),
    isNull(classes.deletedAt),
  );
  return sql<number>`(select count(*) from ${classes} where ${running})`;
}
