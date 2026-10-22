import { classes } from '@edustrux/db';
import type { Class } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import { idsFrom, type OrgCtx } from '../../db/scope';
import { notFound } from '../../lib/errors';
import { termDates } from '../calendar/for-enrolment';
import * as repo from './repository';

// What enrolment asks of classes so that enrolling a student reads in one stage (TUI-94). It is
// in a file of its own only because this module's service and repository were being rewritten
// by another task at the same time. Once both have merged, fold it in: the query for the class's
// term into repository.ts (TUI-96 adds it there as `ofClass`), and `classDatesOf` into
// service.ts beside `classDates`, which then nothing calls.

/**
 * The first and last day a class runs, as `classDates` gives them, asked for by the class's id
 * before the class is in hand. The term is found through that id (D-104), so this goes out in
 * the same stage as the read of the class. The class's own dates come first, so the answer is a
 * function of the class.
 *
 * It says nothing about who may see the class. A caller reads the class with `getClass` as well,
 * and uses nothing it found here when that answers 404.
 */
export async function classDatesOf(ctx: OrgCtx, classId: string) {
  const itsTerm = idsFrom(ctx, classes, classes.termId, eq(classes.id, classId));
  const [term] = await termDates(ctx, itsTerm);
  return (klass: Pick<Class, 'termId' | 'startDate' | 'endDate'>) => {
    if (klass.termId && !term) throw notFound('Term');
    return {
      startDate: klass.startDate ?? term?.startDate ?? null,
      endDate: klass.endDate ?? term?.endDate ?? null,
    };
  };
}

/**
 * A class as an enrolment that is already within the caller's reach shows it, with the first and
 * last day it runs, whoever asks: changing an enrolment needs the class's dates even when the
 * caller reaches the enrolment through its student only. undefined when the class is gone.
 */
export async function classOfEnrolment(ctx: OrgCtx, classId: string) {
  const [row, datesOf] = await Promise.all([
    repo.findClass(ctx, classId, {}),
    classDatesOf(ctx, classId),
  ]);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    courseId: row.courseId,
    branchId: row.branchId,
    ...datesOf(row),
  };
}
