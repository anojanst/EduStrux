import {
  MAX_GRADE_LEVELS,
  newId,
  type Course,
  type CreateCourse,
  type CreateGradeLevel,
  type CreateSubject,
  type GradeLevel,
  type Subject,
  type UpdateCourse,
  type UpdateGradeLevel,
  type UpdateSubject,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import {
  conflict,
  forbidden,
  notFound,
  staleData,
  unprocessable,
  validationFailed,
} from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as billing from '../billing/service';
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

export function toGradeLevel(row: repo.GradeLevelRow): GradeLevel {
  const { orgId: _org, deletedAt: _deleted, ...grade } = row;
  return grade;
}

export function toSubject(row: repo.SubjectRow): Subject {
  const { orgId: _org, deletedAt: _deleted, ...subject } = row;
  return subject;
}

export function toCourse(row: repo.CourseRow): Course {
  const {
    orgId: _org,
    deletedAt: _deleted,
    defaultPriceAmount: amount,
    defaultPriceCurrency: currency,
    ...course
  } = row;
  return {
    ...course,
    defaultPrice: amount !== null && currency !== null ? { amount, currency } : null,
  };
}

/**
 * A course as this caller reads it. Teachers and parents get no default price (D-110): the field
 * is left out, so null still means the course has none.
 */
function forReader(course: Course, access: Access): Course {
  if (access.role !== 'teacher' && access.role !== 'parent') return course;
  const { defaultPrice: _hidden, ...rest } = course;
  return rest;
}

/**
 * Only the owner sets or changes a course's default price (D-111): it comes before the org-wide
 * price rule, so it prices the course's classes in every branch. Other staff who write courses
 * may send the price the course already has, as a form that sends every field does, but not a
 * new one.
 */
function checkPriceWriter(
  access: Access,
  price: CreateCourse['defaultPrice'],
  current: { amount: number | null; currency: string | null },
) {
  if (access.scope === 'all' || price === undefined) return;
  const same =
    price === null
      ? current.amount === null
      : price.amount === current.amount && price.currency === current.currency;
  if (!same) throw forbidden("Only the owner sets a course's default price.");
}

const gradeNameTaken = () =>
  conflict('A grade level with that name already exists', { name: ['Taken'] });
const subjectNameTaken = () =>
  conflict('A subject with that name already exists', { name: ['Taken'] });
const courseTaken = () =>
  conflict(
    'A course with this subject, grade level, curriculum and teaching medium already exists',
    { _: ['Taken'] },
  );

// ── Grade levels ────────────────────────────────────────────────────────────

/** The whole list in grade order: it's capped at MAX_GRADE_LEVELS, so it isn't paged. */
export async function listGradeLevels(ctx: OrgCtx) {
  const rows = await repo.listGradeLevels(ctx);
  return { data: rows.map(toGradeLevel), nextCursor: null };
}

export async function getGradeLevel(ctx: OrgCtx, id: string): Promise<GradeLevel> {
  const row = await repo.findGradeLevel(ctx, id);
  if (!row) throw notFound('Grade level');
  return toGradeLevel(row);
}

/** New grade levels go to the end of the order. */
export async function createGradeLevel(ctx: OrgCtx, input: CreateGradeLevel): Promise<GradeLevel> {
  // Neither read needs the other's answer, so they go to D1 together.
  const [stats, taken] = await Promise.all([
    repo.gradeLevelStats(ctx),
    repo.gradeLevelNameTaken(ctx, input.name),
  ]);
  if (stats.count >= MAX_GRADE_LEVELS) {
    throw unprocessable(`An organisation can have at most ${MAX_GRADE_LEVELS} grade levels.`);
  }
  if (taken) throw gradeNameTaken();

  const row = await repo.insertGradeLevel(ctx, {
    id: newId('gradeLevel'),
    orgId: ctx.orgId,
    name: input.name,
    sortOrder: stats.lastSortOrder + 1,
  });
  return toGradeLevel(row);
}

export async function updateGradeLevel(
  ctx: OrgCtx,
  id: string,
  input: UpdateGradeLevel,
): Promise<GradeLevel> {
  // The name check needs nothing from the grade level's row, so both reads go to D1 together.
  const [before, taken] = await Promise.all([
    repo.findGradeLevel(ctx, id),
    input.name !== undefined ? repo.gradeLevelNameTaken(ctx, input.name, id) : false,
  ]);
  if (!before) throw notFound('Grade level');
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (input.name === undefined) return toGradeLevel(before);
  if (taken) throw gradeNameTaken();

  const updated = await repo.updateGradeLevel(ctx, before, input.name);
  if (!updated) throw notFound('Grade level');
  return toGradeLevel(updated);
}

/** Refused while a course is taught at this grade level, or a student has been in it. */
export async function deleteGradeLevel(ctx: OrgCtx, id: string): Promise<void> {
  // The counts need only the id, so they go to D1 together with the read of the grade level.
  const [before, courseCount, studentCount] = await Promise.all([
    repo.findGradeLevel(ctx, id),
    repo.countCourses(ctx, { gradeLevelId: id }),
    people.countStudentsInGrade(ctx, id),
  ]);
  if (!before) throw notFound('Grade level');
  if (courseCount > 0) {
    throw unprocessable(`Delete this grade level's ${courseCount} course(s) first.`);
  }
  if (studentCount > 0) {
    throw unprocessable(
      `${studentCount} student grade record(s) use this grade level. Change them first.`,
    );
  }
  await repo.softDeleteGradeLevel(ctx, before);
}

/**
 * Puts the org's grade levels in the given order. The list must name every grade level exactly
 * once: an id the org doesn't have is 404, a missing one is 422 (duplicates fail validation).
 */
export async function reorderGradeLevels(ctx: OrgCtx, ids: string[]) {
  const current = await repo.listGradeLevels(ctx);
  const known = new Set(current.map((g) => g.id));
  if (ids.some((id) => !known.has(id))) throw notFound('Grade level');
  if (ids.length !== current.length) {
    throw unprocessable('List every grade level exactly once.', {
      ids: [`Expected ${current.length} ids, got ${ids.length}`],
    });
  }

  // The write returns the rows in the new order, which is the list as it now stands.
  const rows = await repo.reorderGradeLevels(
    ctx,
    current.map((g) => g.id),
    ids,
  );
  return { data: rows.map(toGradeLevel), nextCursor: null };
}

// ── Subjects ────────────────────────────────────────────────────────────────

export async function listSubjects(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listSubjects(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toSubject), nextCursor };
}

export async function createSubject(ctx: OrgCtx, input: CreateSubject): Promise<Subject> {
  if (await repo.subjectNameTaken(ctx, input.name)) throw subjectNameTaken();

  const row = await repo.insertSubject(ctx, {
    id: newId('subject'),
    orgId: ctx.orgId,
    name: input.name,
  });
  return toSubject(row);
}

export async function updateSubject(
  ctx: OrgCtx,
  id: string,
  input: UpdateSubject,
): Promise<Subject> {
  // The name check needs nothing from the subject's row, so both reads go to D1 together.
  const [before, taken] = await Promise.all([
    repo.findSubject(ctx, id),
    input.name !== undefined ? repo.subjectNameTaken(ctx, input.name, id) : false,
  ]);
  if (!before) throw notFound('Subject');
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (input.name === undefined) return toSubject(before);
  if (taken) throw subjectNameTaken();

  const updated = await repo.updateSubject(ctx, before, input.name);
  if (!updated) throw notFound('Subject');
  return toSubject(updated);
}

/** Refused while a course teaches this subject. */
export async function deleteSubject(ctx: OrgCtx, id: string): Promise<void> {
  const [before, courseCount] = await Promise.all([
    repo.findSubject(ctx, id),
    repo.countCourses(ctx, { subjectId: id }),
  ]);
  if (!before) throw notFound('Subject');
  if (courseCount > 0) {
    throw unprocessable(`Delete this subject's ${courseCount} course(s) first.`);
  }
  await repo.softDeleteSubject(ctx, before);
}

// ── Courses ─────────────────────────────────────────────────────────────────

export async function listCourses(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.CourseFilter,
) {
  // The filter ids are checked alongside the page, in one stage.
  const [subject, grade, rows] = await Promise.all([
    filter.subjectId ? repo.findSubject(ctx, filter.subjectId) : undefined,
    filter.gradeLevelId ? repo.findGradeLevel(ctx, filter.gradeLevelId) : undefined,
    repo.listCourses(ctx, limit, decodeCursor(cursor), filter),
  ]);
  if (filter.subjectId && !subject) throw notFound('Subject');
  if (filter.gradeLevelId && !grade) throw notFound('Grade level');
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map((row) => forReader(toCourse(row), access)), nextCursor };
}

export async function getCourse(ctx: OrgCtx, id: string): Promise<Course> {
  const row = await repo.findCourse(ctx, id);
  if (!row) throw notFound('Course');
  return toCourse(row);
}

/** Each of the given courses' default price, by course id. null = the course has none. */
export async function defaultPrices(ctx: OrgCtx, ids: string[]) {
  return new Map(
    (await repo.defaultPrices(ctx, ids)).map(({ id, amount, currency }) => [
      id,
      amount !== null && currency !== null ? { amount, currency } : null,
    ]),
  );
}

/** The columns a default price is stored in. It must be in the org's currency. */
async function priceColumns(ctx: OrgCtx, price: CreateCourse['defaultPrice']) {
  if (!price) return { defaultPriceAmount: null, defaultPriceCurrency: null };
  const org = await orgs.getOrg(ctx);
  if (price.currency !== org.currency) {
    throw validationFailed({
      'defaultPrice.currency': [`Must be the organisation's currency, ${org.currency}`],
    });
  }
  return { defaultPriceAmount: price.amount, defaultPriceCurrency: price.currency };
}

export async function createCourse(
  ctx: OrgCtx,
  access: Access,
  input: CreateCourse,
): Promise<Course> {
  const key = {
    subjectId: input.subjectId,
    gradeLevelId: input.gradeLevelId,
    curriculum: input.curriculum ?? null,
    teachingMedium: input.teachingMedium ?? null,
  };
  // The three reads need nothing from each other, so they go to D1 together. The checks still
  // run in the same order: the subject, the grade level, the price, then the combination.
  const [subject, grade, taken] = await Promise.all([
    repo.findSubject(ctx, input.subjectId),
    repo.findGradeLevel(ctx, input.gradeLevelId),
    repo.courseTaken(ctx, key),
  ]);
  if (!subject) throw notFound('Subject');
  if (!grade) throw notFound('Grade level');
  checkPriceWriter(access, input.defaultPrice, { amount: null, currency: null });
  const price = await priceColumns(ctx, input.defaultPrice);
  if (taken) throw courseTaken();

  const row = await repo.insertCourse(ctx, {
    id: newId('course'),
    orgId: ctx.orgId,
    ...key,
    ...price,
    durationMinutes: input.durationMinutes ?? null,
  });
  return toCourse(row);
}

/** A course keeps its subject and grade level; everything else can change. */
export async function updateCourse(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateCourse,
): Promise<Course> {
  const { updatedAt, defaultPrice, ...rest } = input;
  const newLabels = rest.curriculum !== undefined || rest.teachingMedium !== undefined;
  // The check for a course that would now be the same reads this course's subject, grade level
  // and unsent label itself, so it goes to D1 with the read of the course.
  const [before, taken] = await Promise.all([
    repo.findCourse(ctx, id),
    newLabels ? repo.otherCourseMatches(ctx, id, rest) : false,
  ]);
  if (!before) throw notFound('Course');
  if (before.updatedAt !== updatedAt) throw staleData();
  checkPriceWriter(access, defaultPrice, {
    amount: before.defaultPriceAmount,
    currency: before.defaultPriceCurrency,
  });

  const changes: repo.CourseChanges = { ...rest };
  if (defaultPrice !== undefined) Object.assign(changes, await priceColumns(ctx, defaultPrice));
  if (Object.keys(changes).length === 0) return toCourse(before);
  if (taken) throw courseTaken();

  const updated = await repo.updateCourse(ctx, before, changes);
  if (!updated) throw notFound('Course');
  return toCourse(updated);
}

/** Refused while a class runs this course, or a price rule prices it. */
export async function deleteCourse(ctx: OrgCtx, id: string): Promise<void> {
  // The counts need only the id, so they go to D1 together with the read of the course.
  const [before, classCount, ruleCount] = await Promise.all([
    repo.findCourse(ctx, id),
    classes.countClasses(ctx, { courseId: id }),
    billing.countPriceRules(ctx, { courseId: id }),
  ]);
  if (!before) throw notFound('Course');
  if (classCount > 0) {
    throw unprocessable(`Delete this course's ${classCount} class(es) first.`);
  }
  if (ruleCount > 0) {
    throw unprocessable(`Delete this course's ${ruleCount} price rule(s) first.`);
  }
  await repo.softDeleteCourse(ctx, before);
}
