import { localNow, newId, type CreateEnrolment, type Enrolment } from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import { conflict, unprocessable, validationFailed } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

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

/** Enrolments as the API returns them. A page costs two extra queries, not one per row. */
async function loadEnrolments(ctx: OrgCtx, rows: repo.EnrolmentRow[]): Promise<Enrolment[]> {
  if (rows.length === 0) return [];
  // A student or a class can't be deleted while it has enrolments, so both are always found.
  const [students, labels] = await Promise.all([
    people.studentNames(ctx, [...new Set(rows.map((r) => r.studentId))]),
    classes.classLabels(ctx, [...new Set(rows.map((r) => r.classId))]),
  ]);
  return rows.map((row) =>
    toEnrolment(row, students.get(row.studentId)!, labels.get(row.classId)!),
  );
}

export async function listEnrolments(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: repo.EnrolmentFilter,
) {
  if (filter.studentId) await people.getStudent(ctx, access, filter.studentId);
  if (filter.classId) await classes.getClass(ctx, access, filter.classId);

  const rows = await repo.listEnrolments(
    ctx,
    limit,
    decodeCursor(cursor),
    filter,
    reachOf(ctx, access),
  );
  const { data, nextCursor } = toPage(rows, limit);
  return { data: await loadEnrolments(ctx, data), nextCursor };
}

/**
 * Enrols a student in a class. The caller must reach both: staff limited to some branches can't
 * enrol a student whose home branch is another one, or into another branch's class.
 */
export async function createEnrolment(
  ctx: OrgCtx,
  access: Access,
  input: CreateEnrolment,
): Promise<Enrolment> {
  const student = await people.getStudent(ctx, access, input.studentId);
  const klass = await classes.getClass(ctx, access, input.classId);
  const org = await orgs.getOrg(ctx);

  const price = input.priceOverride ?? null;
  if (price && price.currency !== org.currency) {
    throw validationFailed({
      'priceOverride.currency': [`Must be the organisation's currency, ${org.currency}`],
    });
  }

  const runs = await classes.classDates(ctx, klass);
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

  if (await repo.alreadyEnrolled(ctx, student.id, klass.id)) {
    throw conflict('This student is already enrolled in this class.', {
      _: ['Already enrolled'],
    });
  }
  if (
    klass.capacity !== null &&
    (await repo.countPlacesTaken(ctx, klass.id, startDate)) >= klass.capacity
  ) {
    throw unprocessable(`This class is full: all ${klass.capacity} place(s) are taken.`, {
      classId: ['Full'],
    });
  }

  const id = newId('enrolment');
  await repo.insertEnrolment(ctx, {
    id,
    orgId: ctx.orgId,
    studentId: student.id,
    classId: klass.id,
    startDate,
    endDate,
    priceOverrideAmount: price?.amount ?? null,
    priceOverrideCurrency: price?.currency ?? null,
    status: 'active',
  });
  return toEnrolment((await repo.findEnrolment(ctx, id))!, student, klass);
}

// ── What other modules ask about enrolments ─────────────────────────────────

/** How many enrolments a class or a student has. Neither can be deleted while it has any. */
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
