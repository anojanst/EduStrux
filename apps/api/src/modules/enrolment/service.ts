import {
  addDays,
  localNow,
  newId,
  type CreateEnrolment,
  type Enrolment,
  type EnrolmentUpdate,
  type UpdateEnrolment,
} from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as billing from '../billing/service';
import { classDatesOf, classOfEnrolment } from '../classes/for-enrolment';
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

// ── Changing, withdrawing and transferring (TUI-46) ─────────────────────────

/** The first and last day a class runs, as `classDatesOf` and `classOfEnrolment` give them. */
type Span = { startDate: string | null; endDate: string | null };

/** The fields of `dates` that fall outside the class's, for a 422. */
function outsideClass(span: Span, dates: Record<string, string | null | undefined>) {
  const fields: Record<string, string[]> = {};
  for (const [field, date] of Object.entries(dates)) {
    if (!date) continue;
    if (
      (span.startDate !== null && date < span.startDate) ||
      (span.endDate !== null && date > span.endDate)
    ) {
      fields[field] = ['Outside the class dates'];
    }
  }
  if (Object.keys(fields).length === 0) return;
  const runs = span.endDate ? `${span.startDate} to ${span.endDate}` : `from ${span.startDate} on`;
  throw unprocessable(`An enrolment's dates must fall inside the class's: ${runs}.`, fields);
}

function checkCurrency(
  currency: string,
  price: { currency: string } | null | undefined,
  field: string,
) {
  if (price && price.currency !== currency) {
    throw validationFailed({ [field]: [`Must be the organisation's currency, ${currency}`] });
  }
}

/**
 * Changes an enrolment's dates or price override, withdraws the student, or transfers them to
 * another class. The caller must reach the enrolment, through its class or its student, and for
 * a transfer the new class too.
 *
 * New dates change what the enrolment owes, pro rata by lessons (D-086): a draft invoice's line
 * for it is charged again in the same batch, and an issued one's is reported with what it would
 * charge now (D-095). A price override applies from the next invoice run.
 *
 * Two read stages, then the write: the enrolment and its invoice lines; then its class, its
 * student's name, the class's lessons, and for a transfer the new class and its places.
 */
export async function updateEnrolment(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateEnrolment,
): Promise<EnrolmentUpdate> {
  const [before, lines, org] = await Promise.all([
    repo.findEnrolment(ctx, id, reachOf(ctx, access)),
    billing.linesOfEnrolment(ctx, id),
    orgs.getOrg(ctx),
  ]);
  if (!before) throw notFound('Enrolment');
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { transfer } = input;
  const withdraw = input.status === 'withdrawn';
  const edits =
    input.startDate !== undefined ||
    input.endDate !== undefined ||
    input.priceOverride !== undefined;
  if (before.status === 'withdrawn' && (transfer || withdraw || edits)) {
    throw unprocessable('This enrolment was withdrawn, so it can’t be changed.', {
      status: ['Withdrawn'],
    });
  }
  checkCurrency(org.currency, input.priceOverride, 'priceOverride.currency');
  checkCurrency(org.currency, transfer?.priceOverride, 'transfer.priceOverride.currency');

  const today = localNow(org.timezone).date;
  const needsLessons = lines.some(({ line }) => line.basis !== 'pack');
  const [klass, names, lessons, newClassRead, newDatesOf, places] = await Promise.all([
    classOfEnrolment(ctx, before.classId),
    people.studentNames(ctx, [before.studentId]),
    needsLessons
      ? classes.lessonDates(ctx, [before.classId], {
          startDate: '0000-01-01',
          endDate: '9999-12-31',
        })
      : undefined,
    transfer ? hold(classes.getClass(ctx, access, transfer.classId)) : undefined,
    transfer ? classDatesOf(ctx, transfer.classId) : undefined,
    transfer ? repo.placesIn(ctx, transfer.classId, before.studentId) : undefined,
  ]);
  const student = names.get(before.studentId);
  if (!klass || !student) throw notFound('Enrolment');

  // The enrolment's dates once changed.
  let startDate = input.startDate ?? before.startDate;
  let endDate = input.endDate !== undefined ? input.endDate : before.endDate;
  let added: (repo.NewEnrolmentRow & { id: string }) | undefined;
  let newClass: Awaited<ReturnType<typeof classes.getClass>> | undefined;

  if (transfer) {
    newClass = take(newClassRead!);
    if (newClass.id === before.classId) {
      throw unprocessable('The student is already in this class.', {
        'transfer.classId': ['Same class'],
      });
    }
    const span = newDatesOf!(newClass);
    const newStart =
      transfer.startDate ??
      (span.startDate !== null && span.startDate > today ? span.startDate : today);
    if (newStart < before.startDate) {
      throw unprocessable('A transfer can’t start before the enrolment it ends.', {
        'transfer.startDate': ['Before the enrolment started'],
      });
    }
    outsideClass(span, { 'transfer.startDate': newStart });
    if (places!.alreadyEnrolled) {
      throw conflict('This student is already enrolled in that class.', {
        'transfer.classId': ['Already enrolled'],
      });
    }
    if (newClass.capacity !== null && places!.takenOn(newStart) >= newClass.capacity) {
      throw unprocessable(`That class is full: all ${newClass.capacity} place(s) are taken.`, {
        'transfer.classId': ['Full'],
      });
    }
    endDate = addDays(newStart, -1);
    const price = transfer.priceOverride ?? null;
    added = {
      id: newId('enrolment'),
      orgId: ctx.orgId,
      studentId: before.studentId,
      classId: newClass.id,
      startDate: newStart,
      endDate: null,
      priceOverrideAmount: price?.amount ?? null,
      priceOverrideCurrency: price?.currency ?? null,
      status: 'active',
    };
  } else if (withdraw) {
    // Withdrawn before starting: the day before the start, so no lesson is covered.
    const dayBefore = addDays(startDate, -1);
    endDate = input.endDate ?? (today < dayBefore ? dayBefore : today);
    if (endDate < addDays(startDate, -1)) {
      throw validationFailed({ endDate: ['Before startDate'] });
    }
    outsideClass(klass, { endDate: endDate >= startDate ? endDate : null });
  } else {
    if (endDate !== null && endDate < startDate) {
      throw validationFailed({ endDate: ['Must be on or after startDate'] });
    }
    outsideClass(klass, {
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }

  const changes: repo.EnrolmentChanges = {};
  if (startDate !== before.startDate) changes.startDate = startDate;
  if (endDate !== before.endDate) changes.endDate = endDate;
  if (input.priceOverride !== undefined) {
    changes.priceOverrideAmount = input.priceOverride?.amount ?? null;
    changes.priceOverrideCurrency = input.priceOverride?.currency ?? null;
  }
  if (withdraw || transfer) changes.status = 'withdrawn';
  if (Object.keys(changes).length === 0) {
    return {
      enrolment: forReader(toEnrolment(before, student, klass), access),
      transferredTo: null,
      invoices: [],
    };
  }

  const datesChanged = changes.startDate !== undefined || changes.endDate !== undefined;
  const { statements, adjustments } = datesChanged
    ? billing.adjustForDates(ctx, lines, { startDate, endDate }, lessons?.get(before.classId) ?? [])
    : { statements: [], adjustments: [] };
  const action = transfer
    ? 'enrolment.transferred'
    : withdraw
      ? 'enrolment.withdrawn'
      : 'enrolment.updated';
  const { updated, inserted } = await repo.changeEnrolment(
    ctx,
    before,
    changes,
    statements,
    { action, extra: adjustments.length > 0 ? { invoices: adjustments } : {} },
    added,
  );
  if (!updated) throw staleData();
  return {
    enrolment: forReader(toEnrolment(updated, student, klass), access),
    transferredTo:
      inserted && newClass ? forReader(toEnrolment(inserted, student, newClass), access) : null,
    invoices: adjustments,
  };
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

/**
 * The students a caller reaches through enrolments: those holding an active enrolment the caller
 * may see (`reachOf`). Branch staff reach the students in their branches' classes and their own
 * branches' students in any class; a teacher the students in their classes. undefined when the
 * caller's reach has no limit. With `studentId`, only that student.
 */
export function studentsReached(
  ctx: OrgCtx,
  access: Access,
  studentId?: string,
): IdQuery | undefined {
  const reach = reachOf(ctx, access);
  if (!reach.classIds && !reach.studentIds) return undefined;
  return repo.activeStudentsWithin(ctx, reach, studentId);
}

/** The students who hold an active enrolment in any of these classes. */
export function studentsEnrolledIn(ctx: OrgCtx, classIds: Ids): IdQuery {
  return repo.activeStudents(ctx, classIds);
}

/**
 * The students on these classes' rolls: an active enrolment, or a withdrawn one, whose dates
 * end when they left. A lesson's roster is drawn from them (TUI-46).
 */
export function studentsOnRollOf(ctx: OrgCtx, classIds: Ids): IdQuery {
  return repo.rollStudents(ctx, classIds);
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
 * What an invoice run bills in these classes: the enrolments that cover some part of the dates,
 * active or withdrawn (for the lessons before the student left), each with the dates it covers
 * and its price override.
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
