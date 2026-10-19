import { localNow, newId, type CreateEnrolment, type Enrolment } from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import { conflict, unprocessable, validationFailed } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import { classDatesOf } from '../classes/for-enrolment';
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

// Both endpoints read in one stage (D-102): everything they need goes to D1 together, and the
// checks run afterwards on what came back, in the order they have always run in.
// - What a read needs of another read's answer it gets as a query written into its own
//   statement: the names of the students on the page, the term of the class (D-104).
// - A read of another module that answers 404 by throwing is sent with `hold`, and `take`
//   reports it later. So the same error still wins when several apply.
// - The write answers with the row its own statement returned, so nothing is read back.

type Held<T> = { value: T } | { error: unknown };

/** Sends a read now and keeps its answer, or the error it threw, for `take`. */
async function hold<T>(read: T): Promise<Held<Awaited<T>>> {
  try {
    return { value: await read };
  } catch (error) {
    return { error };
  }
}

/** The answer of a read sent with `hold`. Throws the error if that is what it got. */
function take<T>(held: Held<T>): T {
  if ('error' in held) throw held.error;
  return held.value;
}

type StudentName = { firstName: string; lastName: string };
type ClassLabel = { name: string; courseId: string; branchId: string };

/** An enrolment is read with what a roster needs of its student, and a student's list of its class. */
export function toEnrolment(
  row: repo.EnrolmentRow,
  student: StudentName,
  klass: ClassLabel,
): Enrolment {
  const {
    orgId: _org,
    deletedAt: _deleted,
    priceOverrideAmount: amount,
    priceOverrideCurrency: currency,
    ...enrolment
  } = row;
  return {
    ...enrolment,
    studentFirstName: student.firstName,
    studentLastName: student.lastName,
    className: klass.name,
    courseId: klass.courseId,
    branchId: klass.branchId,
    priceOverride: amount !== null && currency !== null ? { amount, currency } : null,
  };
}

/**
 * An enrolment as this caller reads it. Teachers get no price override, so they see no prices of
 * any kind (D-110). The field is left out, so null still means there is no override. Parents keep
 * theirs: they pay it.
 */
function forReader(enrolment: Enrolment, access: Access): Enrolment {
  if (access.role !== 'teacher') return enrolment;
  const { priceOverride: _hidden, ...rest } = enrolment;
  return rest;
}

/**
 * A role's scope as a filter on enrolments. Branch staff reach the enrolments in their branches'
 * classes and those of their branches' students, wherever the class is. A teacher reaches the
 * enrolments in the classes they teach, and a parent their own children's. It costs no database
 * trip: each list is a query the other module gives, not ids read first (D-104).
 */
function reachOf(ctx: OrgCtx, access: Access): repo.Reach {
  switch (access.scope) {
    case 'all':
      return {};
    case 'branch':
      return access.branchIds
        ? {
            classIds: classes.classesInBranches(ctx, access.branchIds),
            studentIds: people.studentsInBranches(ctx, access.branchIds),
          }
        : {};
    case 'own':
      return access.role === 'teacher'
        ? { classIds: classes.classesTaughtBy(ctx, access.membershipId) }
        : { studentIds: people.studentsOfGuardian(ctx, access.membershipId) };
  }
}

/**
 * Enrolments as the API returns them. The names and labels were read in the same stage as the
 * rows, by a query for the page and not by the rows' own ids. An enrolment made between those
 * statements can be on the page with a student or a class they missed. Those are read now, by
 * id: one more stage, only when that happens.
 */
async function withNames(
  ctx: OrgCtx,
  rows: repo.EnrolmentRow[],
  names: Map<string, StudentName>,
  labels: Map<string, ClassLabel>,
): Promise<Enrolment[]> {
  const missed = (ids: string[], found: Map<string, unknown>) => [
    ...new Set(ids.filter((id) => !found.has(id))),
  ];
  const students = missed(
    rows.map((row) => row.studentId),
    names,
  );
  const klasses = missed(
    rows.map((row) => row.classId),
    labels,
  );
  if (students.length > 0 || klasses.length > 0) {
    const [moreNames, moreLabels] = await Promise.all([
      students.length > 0 ? people.studentNames(ctx, students) : undefined,
      klasses.length > 0 ? classes.classLabels(ctx, klasses) : undefined,
    ]);
    names = new Map([...names, ...(moreNames ?? [])]);
    labels = new Map([...labels, ...(moreLabels ?? [])]);
  }
  // A student or a class can't be deleted while it has enrolments, so both are always found.
  return rows.map((row) => toEnrolment(row, names.get(row.studentId)!, labels.get(row.classId)!));
}

/**
 * One stage: the student and the class asked for are checked while the page is read, and the
 * names of whoever is on the page are read by a query for the page. Asked for one student, every
 * row shows that student, so their name comes from the check and isn't read again. The same goes
 * for one class.
 */
export async function listEnrolments(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.EnrolmentFilter,
) {
  const reach = reachOf(ctx, access);
  const afterId = decodeCursor(cursor);
  const onPage = (column: 'studentId' | 'classId') =>
    repo.onPage(ctx, column, limit, afterId, filter, reach);

  const [student, klass, rows, names, labels] = await Promise.all([
    hold(filter.studentId ? people.getStudent(ctx, access, filter.studentId) : undefined),
    hold(filter.classId ? classes.getClass(ctx, access, filter.classId) : undefined),
    repo.listEnrolments(ctx, limit, afterId, filter, reach),
    filter.studentId ? undefined : people.studentNames(ctx, onPage('studentId')),
    filter.classId ? undefined : classes.classLabels(ctx, onPage('classId')),
  ]);
  const ofStudent = take(student);
  const inClass = take(klass);

  const { data, nextCursor } = toPage(rows, limit);
  const enrolments = await withNames(
    ctx,
    data,
    ofStudent ? new Map([[ofStudent.id, ofStudent]]) : (names ?? new Map()),
    inClass ? new Map([[inClass.id, inClass]]) : (labels ?? new Map()),
  );
  return { data: enrolments.map((e) => forReader(e, access)), nextCursor };
}

/**
 * Enrols a student in a class. The caller must reach both: staff limited to some branches can't
 * enrol a student whose home branch is another one, or into another branch's class.
 *
 * One read stage, then the write. Everything read is found from the two ids in the request: the
 * student, the class, the class's dates, and the places taken in the class.
 */
export async function createEnrolment(
  ctx: OrgCtx,
  access: Access,
  input: CreateEnrolment,
): Promise<Enrolment> {
  const [studentRead, classRead, datesOf, places] = await Promise.all([
    hold(people.getStudent(ctx, access, input.studentId)),
    hold(classes.getClass(ctx, access, input.classId)),
    classDatesOf(ctx, input.classId),
    repo.placesIn(ctx, input.classId, input.studentId),
  ]);
  const student = take(studentRead);
  const klass = take(classRead);
  const org = await orgs.getOrg(ctx);

  const price = input.priceOverride ?? null;
  if (price && price.currency !== org.currency) {
    throw validationFailed({
      'priceOverride.currency': [`Must be the organisation's currency, ${org.currency}`],
    });
  }

  const runs = datesOf(klass);
  const today = localNow(org.timezone).date;
  const startDate =
    input.startDate ?? (runs.startDate !== null && runs.startDate > today ? runs.startDate : today);
  const endDate = input.endDate ?? null;
  if (endDate !== null && endDate < startDate) {
    throw validationFailed({ endDate: ['Must be on or after startDate'] });
  }
  const outside = (date: string) =>
    (runs.startDate !== null && date < runs.startDate) ||
    (runs.endDate !== null && date > runs.endDate);
  const fields: Record<string, string[]> = {};
  if (outside(startDate)) fields.startDate = ['Outside the class dates'];
  if (endDate !== null && outside(endDate)) fields.endDate = ['Outside the class dates'];
  if (Object.keys(fields).length > 0) {
    const span = runs.endDate
      ? `${runs.startDate} to ${runs.endDate}`
      : `from ${runs.startDate} on`;
    throw unprocessable(`An enrolment's dates must fall inside the class's: ${span}.`, fields);
  }

  if (places.alreadyEnrolled) {
    throw conflict('This student is already enrolled in this class.', {
      _: ['Already enrolled'],
    });
  }
  if (klass.capacity !== null && places.takenOn(startDate) >= klass.capacity) {
    throw unprocessable(`This class is full: all ${klass.capacity} place(s) are taken.`, {
      classId: ['Full'],
    });
  }

  const stored = await repo.insertEnrolment(ctx, {
    id: newId('enrolment'),
    orgId: ctx.orgId,
    studentId: student.id,
    classId: klass.id,
    startDate,
    endDate,
    priceOverrideAmount: price?.amount ?? null,
    priceOverrideCurrency: price?.currency ?? null,
    status: 'active',
  });
  return toEnrolment(stored, student, klass);
}

// ── What other modules ask about enrolments ─────────────────────────────────

/** How many enrolments a class or a student has. Neither can be deleted while it has any. */
/**
 * The active enrolments of these students, oldest first, with their names and classes. One
 * stage: the names and the classes are read by queries for the same students.
 */
export async function activeEnrolmentsOf(ctx: OrgCtx, studentIds: Ids): Promise<Enrolment[]> {
  const [rows, names, labels] = await Promise.all([
    repo.activeOf(ctx, studentIds),
    people.studentNames(ctx, studentIds),
    classes.classLabels(ctx, repo.activeClasses(ctx, studentIds)),
  ]);
  return withNames(ctx, rows, names, labels);
}

export function countEnrolments(ctx: OrgCtx, filter: repo.EnrolmentFilter) {
  return repo.countEnrolments(ctx, filter);
}

// Who a caller reaches, for other modules to filter by. Each is a query for ids, written into
// the statement it filters: no database trip (D-104).

/** The students who hold an active enrolment in any of these classes. */
export function studentsEnrolledIn(ctx: OrgCtx, classIds: Ids): IdQuery {
  return repo.activeStudents(ctx, classIds);
}

/** The classes any of these students holds an active enrolment in. */
export function classesOfStudents(ctx: OrgCtx, studentIds: Ids): IdQuery {
  return repo.activeClasses(ctx, studentIds);
}

/** A teacher's "own" students: those with an active enrolment in a class they teach. */
export function studentsTaughtBy(ctx: OrgCtx, teacherMembershipId: string): IdQuery {
  return studentsEnrolledIn(ctx, classes.classesTaughtBy(ctx, teacherMembershipId));
}

/** A parent's "own children's" classes: those one of their children is actively enrolled in. */
export function classesOfChildren(ctx: OrgCtx, parentMembershipId: string): IdQuery {
  return classesOfStudents(ctx, people.studentsOfGuardian(ctx, parentMembershipId));
}

/** Who is expected at a class's lesson on `date`: the students whose active enrolment covers it. */
export function studentIdsExpected(ctx: OrgCtx, classId: string, date: string) {
  return repo.activeStudentIdsOn(ctx, classId, date);
}

/** The classes a student is enrolled in and the dates each enrolment covers. */
export function spansOf(ctx: OrgCtx, studentId: string) {
  return repo.activeSpans(ctx, studentId);
}

/**
 * What an invoice run bills in these classes: the active enrolments that cover some part of the
 * dates, each with the dates it covers and its price override.
 */
export async function enrolmentsToInvoice(
  ctx: OrgCtx,
  classIds: Ids,
  range: { startDate: string; endDate: string },
) {
  const rows = await repo.activeDuring(ctx, classIds, range);
  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    classId: row.classId,
    startDate: row.startDate,
    endDate: row.endDate,
    priceOverride:
      row.priceOverrideAmount !== null && row.priceOverrideCurrency !== null
        ? { amount: row.priceOverrideAmount, currency: row.priceOverrideCurrency }
        : null,
  }));
}
