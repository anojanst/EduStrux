import {
  bankReferenceFor,
  localNow,
  newId,
  normaliseName,
  normalisePhone,
  type AcademicYear,
  type CreateFamily,
  type CreateGuardian,
  type CreateStudent,
  type DuplicateMatches,
  type DuplicateQuery,
  type DuplicateReason,
  type Family,
  type Guardian,
  type Org,
  type PromoteStudents,
  type PromotionResult,
  type SearchQuery,
  type SearchResults,
  type Student,
  type StudentEmergencyContacts,
  type UpdateFamily,
  type UpdateGuardian,
  type UpdateStudent,
} from '@edustrux/shared';
import type { Access, IdQuery, Ids, OrgCtx } from '../../db/scope';
import { forbidden, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { byKeys, decodeKeys, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import { currentAcademicYear } from '../calendar/for-people';
import * as calendar from '../calendar/service';
import * as curriculum from '../curriculum/service';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import type { JobContext } from '../../background/jobs';
import type { JobMessage } from '../../background/messages';
import { startJob } from '../platform/service';
import * as repo from './repository';

// Every function here waits for D1 once to read and, if it writes, once more to write (D-102).
// Reads that don't need each other's answers are sent together with `Promise.all`, and the
// checks on what they found then run in the order they always have, so the same error is
// reported when several apply. A write answers with the rows it has in hand and the row the
// write returned, not with a second read.

type Years = { years: AcademicYear[]; current: AcademicYear | null };
/** A student's grade level in one academic year. */
type GradeOfYear = Pick<repo.GradeRow, 'academicYearId' | 'gradeLevelId'>;

/** What a check found, or the error it threw, kept until its turn comes. */
type Held<T> = { value: T } | { error: unknown };

/**
 * Sends another module's check now and keeps what it throws for later. `orThrow` then judges it
 * where the check used to run, after any check that came before it.
 */
const held = <T>(check: Promise<T>): Promise<Held<T>> =>
  check.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

function orThrow<T>(answer: Held<T>): T {
  if ('error' in answer) throw answer.error;
  return answer.value;
}

export function toGuardian(row: repo.GuardianRow): Guardian {
  const {
    orgId: _org,
    deletedAt: _deleted,
    firstNameNorm: _first,
    lastNameNorm: _last,
    phoneNorm: _phone,
    ...guardian
  } = row;
  return guardian;
}

/** `grades` are the student's own; they come back in academic-year order. */
export function toStudent(
  row: repo.StudentRow,
  branchId: string,
  grades: GradeOfYear[],
  { years, current }: Years,
): Student {
  const {
    orgId: _org,
    deletedAt: _deleted,
    firstNameNorm: _first,
    lastNameNorm: _last,
    ...student
  } = row;
  const order = new Map(years.map((year, index) => [year.id, index]));
  const position = (grade: GradeOfYear) => order.get(grade.academicYearId) ?? years.length;
  return {
    ...student,
    branchId,
    gradeLevelId: grades.find((g) => g.academicYearId === current?.id)?.gradeLevelId ?? null,
    grades: [...grades]
      .sort((a, b) => position(a) - position(b))
      .map((g) => ({ academicYearId: g.academicYearId, gradeLevelId: g.gradeLevelId })),
  };
}

/**
 * A student as this caller reads them. A student's notes are for staff, so parents don't get them
 * (D-126). The field is left out, so null still means there are none.
 */
function forReader(student: Student, access: Access): Student {
  if (access.role !== 'parent') return student;
  const { notes: _hidden, ...rest } = student;
  return rest;
}

export function toFamily(
  row: repo.FamilyRow,
  guardians: repo.GuardianRow[],
  students: Student[],
): Family {
  const { orgId: _org, deletedAt: _deleted, nameNorm: _norm, ...family } = row;
  return { ...family, guardians: guardians.map(toGuardian), students };
}

/**
 * A role's scope as a filter on families. Branch staff reach the families whose home branch is
 * one of theirs, and a parent the families they are a signed-in guardian of. A teacher reaches
 * the students enrolled in the classes they teach, with those students' families and guardians.
 * It costs no database trip: a teacher's students are a query, not a list read first (D-104).
 */
function reachOf(ctx: OrgCtx, access: Access): repo.Reach {
  switch (access.scope) {
    case 'all':
      return {};
    case 'branch':
      return access.branchIds ? { branchIds: access.branchIds } : {};
    case 'own':
      return access.role === 'parent'
        ? { guardianMembershipId: access.membershipId }
        : { studentIds: enrolment.studentsTaughtBy(ctx, access.membershipId) };
  }
}

/** Branch staff can only place a family in one of their own branches. */
function checkBranchWithinReach(access: Access, branchId: string) {
  if (access.scope !== 'all' && access.branchIds && !access.branchIds.includes(branchId)) {
    throw forbidden();
  }
}

async function findFamilyOr404(ctx: OrgCtx, id: string, reach: repo.Reach) {
  const row = await repo.findFamily(ctx, id, reach);
  if (!row) throw notFound('Family');
  return row;
}

async function findGuardianOr404(ctx: OrgCtx, id: string, reach: repo.Reach) {
  const row = await repo.findGuardian(ctx, id, reach);
  if (!row) throw notFound('Guardian');
  return row;
}

/**
 * What families are shown with: their guardians, their students within reach, those students'
 * grades and the academic years. `familyIds` is a query for the families the caller's own read
 * returns: the one found, or those on a page. The four reads are sent together, so a caller that
 * sends its read of the families in the same `Promise.all` waits for D1 once.
 */
function membersOf(ctx: OrgCtx, familyIds: Ids, reach: repo.Reach) {
  return Promise.all([
    repo.listGuardians(ctx, familyIds),
    repo.studentsOfFamilies(ctx, familyIds, reach),
    repo.listGrades(ctx, repo.studentIdsOfFamilies(ctx, familyIds, reach)),
    calendar.academicYears(ctx),
  ]);
}
type Members = Awaited<ReturnType<typeof membersOf>>;

/**
 * Families as this caller reads them, each with its own guardians and students out of `members`.
 */
function withMembers(
  rows: repo.FamilyRow[],
  [guardians, students, grades, years]: Members,
  access: Access,
): Family[] {
  return rows.map((family) =>
    toFamily(
      family,
      guardians.filter((g) => g.familyId === family.id),
      students
        .filter((s) => s.familyId === family.id)
        .map((student) =>
          forReader(
            toStudent(
              student,
              family.branchId,
              grades.filter((g) => g.studentId === student.id),
              years,
            ),
            access,
          ),
        ),
    ),
  );
}

// ── Families ────────────────────────────────────────────────────────────────

export async function listFamilies(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: { branchId?: string },
) {
  const reach = reachOf(ctx, access);
  const after = decodeKeys(cursor, 2);
  // The page, and what it shows of other tables by a query for the families on it.
  const [branch, rows, members] = await Promise.all([
    filter.branchId ? held(branches.getBranch(ctx, filter.branchId)) : undefined,
    repo.listFamilies(ctx, limit, after, filter, reach),
    membersOf(ctx, repo.familiesOnPage(ctx, limit, after, filter, reach), reach),
  ]);
  if (branch) orThrow(branch);
  const { data, nextCursor } = toPage(rows, limit, (f) => byKeys(f.nameNorm, f.id));
  return { data: withMembers(data, members, access), nextCursor };
}

/**
 * One stage: the family and what it is shown with are read together. Each read carries the
 * caller's reach, so for a family outside it nothing is read, and nothing is returned unless the
 * family itself was found.
 */
export async function getFamily(ctx: OrgCtx, access: Access, id: string): Promise<Family> {
  const reach = reachOf(ctx, access);
  const [row, members] = await Promise.all([
    repo.findFamily(ctx, id, reach),
    membersOf(ctx, repo.familyFound(ctx, id, reach), reach),
  ]);
  if (!row) throw notFound('Family');
  return withMembers([row], members, access)[0]!;
}

/** How many families have this home branch. A branch can't be deleted while any do. */
export function countFamilies(ctx: OrgCtx, branchId: string) {
  return repo.countFamilies(ctx, branchId);
}

export async function createFamily(
  ctx: OrgCtx,
  access: Access,
  input: CreateFamily,
): Promise<Family> {
  await branches.getBranch(ctx, input.branchId);
  checkBranchWithinReach(access, input.branchId);

  const id = newId('family');
  const row = await repo.insertFamily(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    nameNorm: normaliseName(input.name),
    branchId: input.branchId,
    address: input.address ?? null,
    billingGuardianId: null,
    bankReference: bankReferenceFor(id),
  });
  // A new family has nobody in it yet.
  return toFamily(row, [], []);
}

/** A family can move to another home branch; branch staff only into one of their own. */
export async function updateFamily(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateFamily,
): Promise<Family> {
  const reach = reachOf(ctx, access);
  const { updatedAt, ...rest } = input;
  const changes: repo.FamilyChanges = { ...rest };
  // The family, what the answer shows it with, and the branch it may be moving to. The branch
  // is only judged below if it isn't the family's own, which is known once the family is read.
  const [before, members, branch] = await Promise.all([
    repo.findFamily(ctx, id, reach),
    membersOf(ctx, repo.familyFound(ctx, id, reach), reach),
    changes.branchId !== undefined ? held(branches.getBranch(ctx, changes.branchId)) : undefined,
  ]);
  if (!before) throw notFound('Family');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return withMembers([before], members, access)[0]!;

  if (changes.name !== undefined) changes.nameNorm = normaliseName(changes.name);
  if (changes.branchId !== undefined && changes.branchId !== before.branchId) {
    if (branch) orThrow(branch);
    checkBranchWithinReach(access, changes.branchId);
  }
  if (changes.billingGuardianId && changes.billingGuardianId !== before.billingGuardianId) {
    const [guardians] = members;
    if (!guardians.some((g) => g.id === changes.billingGuardianId)) {
      throw unprocessable("The billing contact must be one of the family's guardians.", {
        billingGuardianId: ['Not a guardian of this family'],
      });
    }
  }

  const updated = await repo.updateFamily(ctx, before, changes);
  if (!updated) throw notFound('Family');
  // The students carry their family's home branch, so they move with it.
  return withMembers([updated], members, access)[0]!;
}

/** Deletes the family and its guardians. Refused while the family has students. */
export async function deleteFamily(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const [before, studentCount] = await Promise.all([
    repo.findFamily(ctx, id, reachOf(ctx, access)),
    repo.countStudents(ctx, id),
  ]);
  if (!before) throw notFound('Family');
  if (studentCount > 0) {
    throw unprocessable(`Delete this family's ${studentCount} student(s) first.`);
  }
  await repo.softDeleteFamily(ctx, before);
}

// ── Guardians ───────────────────────────────────────────────────────────────

/** A family's first guardian becomes its billing contact. */
export async function createGuardian(
  ctx: OrgCtx,
  access: Access,
  familyId: string,
  input: CreateGuardian,
): Promise<Guardian> {
  const family = await findFamilyOr404(ctx, familyId, reachOf(ctx, access));

  const row = await repo.insertGuardian(
    ctx,
    {
      id: newId('guardian'),
      orgId: ctx.orgId,
      familyId,
      firstName: input.firstName,
      lastName: input.lastName,
      firstNameNorm: normaliseName(input.firstName),
      lastNameNorm: normaliseName(input.lastName),
      relationship: input.relationship ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phoneNorm: normalisePhone(input.phone),
      preferredChannel: input.preferredChannel,
      language: input.language ?? null,
      emergencyContact: input.emergencyContact,
      membershipId: null,
    },
    family.billingGuardianId === null,
  );
  return toGuardian(row);
}

export async function updateGuardian(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateGuardian,
): Promise<Guardian> {
  const { guardian: before } = await findGuardianOr404(ctx, id, reachOf(ctx, access));
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...rest } = input;
  const changes: repo.GuardianChanges = { ...rest };
  if (Object.keys(changes).length === 0) return toGuardian(before);
  if (changes.firstName !== undefined) changes.firstNameNorm = normaliseName(changes.firstName);
  if (changes.lastName !== undefined) changes.lastNameNorm = normaliseName(changes.lastName);
  if (changes.phone !== undefined) changes.phoneNorm = normalisePhone(changes.phone);

  const updated = await repo.updateGuardian(ctx, before, changes);
  if (!updated) throw notFound('Guardian');
  return toGuardian(updated);
}

/**
 * The billing contact can't be deleted: another guardian must take over first. So a family's
 * last guardian goes only when the family does.
 */
export async function deleteGuardian(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const { guardian, family } = await findGuardianOr404(ctx, id, reachOf(ctx, access));
  if (family.billingGuardianId === guardian.id) {
    throw unprocessable(
      "This guardian is the family's billing contact. Make another guardian the billing contact first.",
    );
  }
  await repo.softDeleteGuardian(ctx, guardian);
}

/** A guardian within the caller's reach, to invite to sign in. 404 outside it. */
export async function guardianToInvite(ctx: OrgCtx, access: Access, id: string) {
  return (await findGuardianOr404(ctx, id, reachOf(ctx, access))).guardian;
}

/** A guardian of the org, whoever asks: an invite being accepted names one. */
export async function findGuardian(ctx: OrgCtx, id: string) {
  return (await repo.findGuardian(ctx, id, {}))?.guardian;
}

/** Signs a guardian in as a parent membership, as a statement for the caller's batch (D-053). */
export function linkGuardianStatement(ctx: OrgCtx, guardianId: string, membershipId: string) {
  return repo.linkGuardianStatement(ctx, guardianId, membershipId);
}

/** Unlinks the guardians a removed parent membership signed in as (D-053), for the caller's batch. */
export function unlinkMembershipStatement(ctx: OrgCtx, membershipId: string) {
  return repo.unlinkMembershipStatement(ctx, membershipId);
}

// ── Students ────────────────────────────────────────────────────────────────

/** A birth date can't be after today, in the org's timezone. */
function checkBirthDate(org: Org, dateOfBirth: string | null | undefined) {
  if (dateOfBirth && dateOfBirth > localNow(org.timezone).date) {
    throw validationFailed({ dateOfBirth: ['In the future'] });
  }
}

/**
 * The academic year a grade is for: the one named, which must be one of the org's (404), or the
 * current one. null when the org has no academic years yet, so nobody can have a grade. It reads
 * nothing: `years` is every year of the org, already read.
 */
function gradeYear({ years, current }: Years, academicYearId: string | undefined) {
  if (!academicYearId) return current?.id ?? null;
  if (!years.some((year) => year.id === academicYearId)) throw notFound('Academic year');
  return academicYearId;
}

const noAcademicYear = () =>
  unprocessable('Add an academic year before giving a student a grade level.', {
    gradeLevelId: ['No academic year yet'],
  });

/** What a student with no grade is shown with: no year is needed to work theirs out. */
const NO_YEARS: Years = { years: [], current: null };

/**
 * A student's grades once a change to one year's grade is written, as the repository writes it:
 * the year's row is removed when there was one and no grade level is given, and set otherwise.
 */
function gradesAfter(grades: GradeOfYear[], change: repo.GradeChange | undefined): GradeOfYear[] {
  if (!change) return grades;
  const { academicYearId, gradeLevelId, existing } = change;
  const others = grades.filter((grade) => grade.academicYearId !== academicYearId);
  if (gradeLevelId === null || (existing && !gradeLevelId)) return others;
  return [...others, { academicYearId, gradeLevelId }];
}

export async function listStudents(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: { familyId?: string; branchId?: string; gradeLevelId?: string; academicYearId?: string },
) {
  const reach = reachOf(ctx, access);
  const after = decodeKeys(cursor, 3);
  // The grade filter is for the year named, or for the current one. The current one is a query
  // the calendar gives, so the page doesn't wait for the years to be read. With no year at all
  // it finds nobody.
  const filter: repo.StudentFilter = {
    familyId: query.familyId,
    branchId: query.branchId,
    grade: query.gradeLevelId
      ? {
          gradeLevelId: query.gradeLevelId,
          academicYearId: query.academicYearId || (await currentAcademicYear(ctx)),
        }
      : undefined,
  };
  // The checks on the filters, the page, and the grades of the students on it by a query.
  const [family, branch, gradeLevel, rows, grades, years] = await Promise.all([
    query.familyId ? repo.findFamily(ctx, query.familyId, reach) : undefined,
    query.branchId ? held(branches.getBranch(ctx, query.branchId)) : undefined,
    query.gradeLevelId ? held(curriculum.getGradeLevel(ctx, query.gradeLevelId)) : undefined,
    repo.listStudents(ctx, limit, after, filter, reach),
    repo.listGrades(ctx, repo.studentsOnPage(ctx, limit, after, filter, reach)),
    calendar.academicYears(ctx),
  ]);
  if (query.familyId && !family) throw notFound('Family');
  if (branch) orThrow(branch);
  if (gradeLevel) {
    orThrow(gradeLevel);
    gradeYear(years, query.academicYearId);
  }

  const { data, nextCursor } = toPage(
    rows.map((row) => ({ ...row, id: row.student.id })),
    limit,
    ({ student }) => byKeys(student.lastNameNorm, student.firstNameNorm, student.id),
  );
  return {
    data: data.map(({ student, branchId }) =>
      forReader(
        toStudent(
          student,
          branchId,
          grades.filter((g) => g.studentId === student.id),
          years,
        ),
        access,
      ),
    ),
    nextCursor,
  };
}

/**
 * One stage: the student, their grades and the academic years are read together. Each read
 * carries the caller's reach, so for a student outside it nothing is read, and nothing is
 * returned unless the student was found.
 */
export async function getStudent(ctx: OrgCtx, access: Access, id: string): Promise<Student> {
  const reach = reachOf(ctx, access);
  const [found, grades, years] = await Promise.all([
    repo.findStudent(ctx, id, reach),
    repo.listGrades(ctx, repo.studentFound(ctx, id, reach)),
    calendar.academicYears(ctx),
  ]);
  if (!found) throw notFound('Student');
  return forReader(toStudent(found.student, found.branchId, grades, years), access);
}

export async function createStudent(
  ctx: OrgCtx,
  access: Access,
  input: CreateStudent,
): Promise<Student> {
  const { gradeLevelId } = input;
  const [family, org, gradeLevel, years] = await Promise.all([
    repo.findFamily(ctx, input.familyId, reachOf(ctx, access)),
    orgs.getOrg(ctx),
    gradeLevelId ? held(curriculum.getGradeLevel(ctx, gradeLevelId)) : undefined,
    gradeLevelId ? calendar.academicYears(ctx) : NO_YEARS,
  ]);
  if (!family) throw notFound('Family');
  checkBirthDate(org, input.dateOfBirth);
  let academicYearId: string | null = null;
  if (gradeLevelId) {
    if (gradeLevel) orThrow(gradeLevel);
    academicYearId = gradeYear(years, input.academicYearId);
    if (!academicYearId) throw noAcademicYear();
  }

  const id = newId('student');
  const grade =
    gradeLevelId && academicYearId
      ? { id: newId('studentGrade'), orgId: ctx.orgId, studentId: id, academicYearId, gradeLevelId }
      : null;
  const row = await repo.insertStudent(
    ctx,
    {
      id,
      orgId: ctx.orgId,
      familyId: input.familyId,
      firstName: input.firstName,
      lastName: input.lastName,
      firstNameNorm: normaliseName(input.firstName),
      lastNameNorm: normaliseName(input.lastName),
      dateOfBirth: input.dateOfBirth ?? null,
      notes: input.notes ?? null,
    },
    grade,
  );
  return toStudent(row, family.branchId, grade ? [grade] : [], years);
}

/**
 * A student stays in their family. `gradeLevelId` sets (or with null, removes) the grade for
 * `academicYearId`, or for the current academic year when that is left out.
 */
export async function updateStudent(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateStudent,
): Promise<Student> {
  const reach = reachOf(ctx, access);
  const { updatedAt, gradeLevelId, academicYearId, ...rest } = input;
  const changes: repo.StudentChanges = { ...rest };
  // The student, every grade they have (the one being changed is among them, and the answer
  // shows them all), the academic years, and the grade level they may be given.
  const [found, grades, years, org, gradeLevel] = await Promise.all([
    repo.findStudent(ctx, id, reach),
    repo.listGrades(ctx, repo.studentFound(ctx, id, reach)),
    calendar.academicYears(ctx),
    orgs.getOrg(ctx),
    gradeLevelId ? held(curriculum.getGradeLevel(ctx, gradeLevelId)) : undefined,
  ]);
  if (!found) throw notFound('Student');
  const { student: before, branchId } = found;
  if (before.updatedAt !== updatedAt) throw staleData();

  if (changes.firstName !== undefined) changes.firstNameNorm = normaliseName(changes.firstName);
  if (changes.lastName !== undefined) changes.lastNameNorm = normaliseName(changes.lastName);
  checkBirthDate(org, changes.dateOfBirth);

  let grade: repo.GradeChange | undefined;
  if (gradeLevelId !== undefined) {
    if (gradeLevel) orThrow(gradeLevel);
    const yearId = gradeYear(years, academicYearId);
    if (!yearId && gradeLevelId) throw noAcademicYear();
    const existing = grades.find((g) => g.academicYearId === yearId);
    if (yearId && (existing?.gradeLevelId ?? null) !== gradeLevelId) {
      grade = { academicYearId: yearId, gradeLevelId, existing, newId: newId('studentGrade') };
    }
  }
  if (Object.keys(changes).length === 0 && !grade) {
    return toStudent(before, branchId, grades, years);
  }

  const updated = await repo.updateStudent(ctx, before, changes, grade);
  if (!updated) throw notFound('Student');
  return toStudent(updated, branchId, gradesAfter(grades, grade), years);
}

/** Deletes the student and their grade history. Refused while the student has enrolments. */
export async function deleteStudent(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const [found, enrolmentCount] = await Promise.all([
    repo.findStudent(ctx, id, reachOf(ctx, access)),
    enrolment.countEnrolments(ctx, { studentId: id }),
  ]);
  if (!found) throw notFound('Student');
  if (enrolmentCount > 0) {
    throw unprocessable(
      `This student has ${enrolmentCount} enrolment(s), so they can't be deleted.`,
    );
  }
  await repo.softDeleteStudent(ctx, found.student);
}

/**
 * A parent's children as the API returns students, each with their family's name, in name order:
 * every student of the families they are a signed-in guardian of. One stage: the students, their
 * families, their grades and the academic years are read together, each by a query for the
 * families.
 */
export async function childrenOfGuardian(ctx: OrgCtx, guardianMembershipId: string) {
  const reach: repo.Reach = { guardianMembershipId };
  const familyIds = repo.familiesWithin(ctx, reach);
  const [families, rows, grades, years] = await Promise.all([
    repo.familyLabels(ctx, familyIds),
    repo.studentsOfFamilies(ctx, familyIds, {}),
    repo.listGrades(ctx, repo.studentIdsOfFamilies(ctx, familyIds, {})),
    calendar.academicYears(ctx),
  ]);
  const familyOf = new Map(families.map((family) => [family.id, family]));
  // A guardian unlinked between those statements can leave a child without their family: they
  // are no longer the parent's to see.
  return rows.flatMap((row) => {
    const family = familyOf.get(row.familyId);
    if (!family) return [];
    const ownGrades = grades.filter((g) => g.studentId === row.id);
    return [
      { student: toStudent(row, family.branchId, ownGrades, years), familyName: family.name },
    ];
  });
}

// ── Who a caller reaches, for other modules to filter by ─────────────────────
// Each is a query for ids, written into the statement it filters: no database trip (D-104).

/** The students of the families whose home branch is one of these. Wide: a share of the org. */
export function studentsInBranches(ctx: OrgCtx, branchIds: string[]): IdQuery {
  return repo.studentsWithin(ctx, { branchIds });
}

/** A parent's own children: the students of the families they are a signed-in guardian of. */
export function studentsOfGuardian(ctx: OrgCtx, guardianMembershipId: string): IdQuery {
  return repo.studentsWithin(ctx, { guardianMembershipId });
}

/** The families whose home branch is one of these. Wide: a share of the org. */
export function familiesInBranches(ctx: OrgCtx, branchIds: string[]): IdQuery {
  return repo.familiesWithin(ctx, { branchIds });
}

/** A parent's own families: the ones they are a signed-in guardian of. */
export function familiesOfGuardian(ctx: OrgCtx, guardianMembershipId: string): IdQuery {
  return repo.familiesWithin(ctx, { guardianMembershipId });
}

// Two of them as real ids, each read in a trip of its own, for the two callers that still work
// on the ids themselves: the attendance roster and the invoice list's branch filter.

/** A parent's own children, read now. */
export function studentIdsOfGuardian(ctx: OrgCtx, guardianMembershipId: string) {
  return repo.studentIds(ctx, { guardianMembershipId });
}

/** The families whose home branch is one of these, read now. */
export function familyIdsInBranches(ctx: OrgCtx, branchIds: string[]) {
  return repo.familyIds(ctx, { branchIds });
}

// ── What other modules load by ids ──────────────────────────────────────────
// `ids` can be a query: the names of whatever another read returns, in the same stage.

/** What a record that points at a family shows of it, by family id, whoever is asking. */
export async function familyLabels(ctx: OrgCtx, ids: Ids) {
  return new Map((await repo.familyLabels(ctx, ids)).map(({ id, ...label }) => [id, label]));
}

/** Each of the given students' family, by student id. */
export async function familyIdsOfStudents(ctx: OrgCtx, ids: Ids) {
  return new Map((await repo.studentFamilies(ctx, ids)).map((row) => [row.id, row.familyId]));
}

/**
 * The given students by name, each with the guardians to call in an emergency: name,
 * relationship and phone only (D-112). For whoever may see the students on a class's roster,
 * whichever branch their families belong to. One stage: both reads go by a query for the students.
 */
export async function emergencyContactsOf(
  ctx: OrgCtx,
  studentIds: Ids,
): Promise<StudentEmergencyContacts[]> {
  const [rows, contacts] = await Promise.all([
    repo.studentsByName(ctx, studentIds),
    repo.emergencyContacts(ctx, studentIds),
  ]);
  return rows.map((student) => ({
    studentId: student.id,
    studentFirstName: student.firstName,
    studentLastName: student.lastName,
    contacts: contacts
      .filter((contact) => contact.familyId === student.familyId)
      .map(({ familyId: _family, ...contact }) => contact),
  }));
}

/** The names of the given students, by student id, whoever is asking. */
export async function studentNames(ctx: OrgCtx, ids: Ids) {
  return new Map((await repo.studentNames(ctx, ids)).map(({ id, ...name }) => [id, name]));
}

/** How many students have been in this grade level, in any year. It can't be deleted while any have. */
export function countStudentsInGrade(ctx: OrgCtx, gradeLevelId: string) {
  return repo.countStudentsInGrade(ctx, gradeLevelId);
}

// ── Search and duplicate warnings (TUI-43) ──────────────────────────────────

/** A phone as typed into a search: only phone characters, and at least 3 digits. */
function phoneIn(typed: string) {
  if (!/^[0-9+() .-]+$/.test(typed)) return undefined;
  const digits = normalisePhone(typed);
  return digits && digits.length >= 3 ? digits : undefined;
}

/** A family's bank reference as typed: 8 letters and digits, matched in capitals. */
const bankReferenceIn = (typed: string) =>
  /^[0-9a-z]{8}$/i.test(typed) ? typed.toUpperCase() : undefined;

const withoutPhoneNorm = <T extends { phoneNorm: string | null }>({ phoneNorm: _p, ...row }: T) =>
  row;

/**
 * The guardians that match by name, email or phone, each once, in name order. The three are read
 * apart (see `repo.matchGuardians`), in the same stage.
 */
async function matchGuardians(
  ctx: OrgCtx,
  { email, phone, ...names }: repo.PersonMatch,
  limit: number,
  reach: repo.Reach,
) {
  const byName = names.namePrefix !== undefined || names.name !== undefined;
  const reads = await Promise.all([
    byName ? repo.matchGuardians(ctx, names, limit, reach) : [],
    email !== undefined ? repo.matchGuardians(ctx, { email }, limit, reach) : [],
    phone !== undefined ? repo.matchGuardians(ctx, { phone }, limit, reach) : [],
  ]);
  const found = new Map(reads.flat().map((row) => [row.id, row]));
  const key = (row: { lastName: string; firstName: string; id: string }) =>
    `${normaliseName(row.lastName)}\u0000${normaliseName(row.firstName)}\u0000${row.id}`;
  return [...found.values()]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .slice(0, limit);
}

/**
 * Families, students and guardians within the caller's reach that `q` finds: the start of a name,
 * or an exact email, phone or bank reference (D-026). One stage: the three reads go together.
 */
export async function search(
  ctx: OrgCtx,
  access: Access,
  query: SearchQuery,
): Promise<SearchResults> {
  const typed = query.q.trim();
  const namePrefix = normaliseName(typed);
  const reach = reachOf(ctx, access);
  const person: repo.PersonMatch = {
    namePrefix,
    email: typed.includes('@') ? typed.toLowerCase() : undefined,
    phone: phoneIn(typed),
  };
  const [families, students, guardians] = await Promise.all([
    repo.matchFamilies(
      ctx,
      { namePrefix, bankReference: bankReferenceIn(typed) },
      query.limit,
      reach,
    ),
    repo.matchStudents(ctx, { namePrefix }, query.limit, reach),
    matchGuardians(ctx, person, query.limit, reach),
  ]);
  return { families, students, guardians: guardians.map(withoutPhoneNorm) };
}

const DUPLICATE_LIMIT = 20;

/**
 * Who within the caller's reach may already be on record as the family, student or guardian
 * about to be added, and why. A warning only: nothing stops the add. One stage.
 */
export async function duplicates(
  ctx: OrgCtx,
  access: Access,
  query: DuplicateQuery,
): Promise<DuplicateMatches> {
  const reach = reachOf(ctx, access);
  const empty: DuplicateMatches = { families: [], students: [], guardians: [] };
  const name =
    query.firstName && query.lastName
      ? { first: normaliseName(query.firstName), last: normaliseName(query.lastName) }
      : undefined;

  if (query.kind === 'family') {
    const rows = await repo.matchFamilies(
      ctx,
      { name: normaliseName(query.name ?? '') },
      DUPLICATE_LIMIT,
      reach,
    );
    return { ...empty, families: rows.map((row) => ({ ...row, reasons: ['same_name'] })) };
  }

  if (query.kind === 'student') {
    const rows = await repo.matchStudents(ctx, { name }, DUPLICATE_LIMIT, reach);
    return {
      ...empty,
      students: rows.map((row) => ({
        ...row,
        reasons: [
          query.dateOfBirth && row.dateOfBirth === query.dateOfBirth
            ? 'same_name_and_birth_date'
            : 'same_name',
        ],
      })),
    };
  }

  const email = query.email || undefined;
  const phone = normalisePhone(query.phone) ?? undefined;
  const rows = await matchGuardians(ctx, { name, email, phone }, DUPLICATE_LIMIT, reach);
  return {
    ...empty,
    guardians: rows.map((row) => {
      const reasons: DuplicateReason[] = [];
      if (
        name &&
        normaliseName(row.firstName) === name.first &&
        normaliseName(row.lastName) === name.last
      ) {
        reasons.push('same_name');
      }
      if (email && row.email === email) reasons.push('same_email');
      if (phone && row.phoneNorm === phone) reasons.push('same_phone');
      return { ...withoutPhoneNorm(row), reasons };
    }),
  };
}

// ── Who a message goes to (TUI-69) ──────────────────────────────────────────

/** The families of these students, as ids to filter by. */
export function familiesOfStudentIds(ctx: OrgCtx, studentIds: Ids): IdQuery {
  return repo.familiesOfStudentIds(ctx, studentIds);
}

/** The students with one of these grade levels in the current academic year. */
export async function studentsInGrades(ctx: OrgCtx, gradeLevelIds: string[]): Promise<IdQuery> {
  return repo.studentsInGrades(ctx, gradeLevelIds, await currentAcademicYear(ctx));
}

/**
 * The guardians of these families that the caller reaches, with their emails: who a message to
 * those families goes to. Branch staff reach their branches' families, a teacher their students'.
 */
export function guardiansToMessage(ctx: OrgCtx, access: Access, familyIds: Ids) {
  return repo.guardiansOf(ctx, familyIds, reachOf(ctx, access));
}

/** The guardians of these families, whoever asks: an automatic message goes to all of them. */
export function guardiansOfFamilies(ctx: OrgCtx, familyIds: Ids) {
  return repo.guardiansOf(ctx, familyIds, {});
}

/** Of these family ids, the ones the caller reaches. */
export async function familiesReached(ctx: OrgCtx, access: Access, ids: string[]) {
  return (await repo.familiesFound(ctx, ids, reachOf(ctx, access))).map((row) => row.id);
}

/** Every family in the org, as ids to filter by. Wide: all of them. */
export function allFamilies(ctx: OrgCtx): IdQuery {
  return repo.familiesWithin(ctx, {});
}

/** How many families the caller reaches, for the dashboard. */
export function countFamiliesReached(ctx: OrgCtx, access: Access) {
  return repo.countFamiliesWithin(ctx, reachOf(ctx, access));
}

// ── Year-end promotion (TUI-45) ─────────────────────────────────────────────

/** The job type of a year-end promotion. */
export const PROMOTION = 'students.promote';

type PromotionInput = PromoteStudents & { branchIds: string[] | null };

/**
 * Checks a promotion and queues it as a job: both years must be the org's (404), the new one
 * starting after the old, and an exception's student must be one the caller reaches (404) and its
 * grade one of the org's (404). Branch staff promote their branches' students only.
 */
export async function startPromotion(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<JobMessage>,
  input: PromoteStudents,
): Promise<string> {
  const reach = reachOf(ctx, access);
  const named = input.exceptions.map((e) => e.studentId);
  const [from, to, grades, reached] = await Promise.all([
    held(calendar.getAcademicYear(ctx, input.fromAcademicYearId)),
    held(calendar.getAcademicYear(ctx, input.toAcademicYearId)),
    curriculum.listGradeLevels(ctx),
    named.length > 0 ? repo.studentsAmong(ctx, named, reach) : [],
  ]);
  const fromYear = orThrow(from);
  const toYear = orThrow(to);
  if (toYear.startDate <= fromYear.startDate) {
    throw unprocessable('The new academic year must start after the one being promoted from.', {
      toAcademicYearId: ['Not after fromAcademicYearId'],
    });
  }
  const gradeIds = new Set(grades.data.map((g) => g.id));
  for (const e of input.exceptions) {
    if (e.gradeLevelId && !gradeIds.has(e.gradeLevelId)) throw notFound('Grade level');
  }
  if (reached.length < named.length) throw notFound('Student');
  const jobInput: PromotionInput = {
    ...input,
    branchIds: access.scope === 'branch' ? access.branchIds : null,
  };
  return startJob(ctx, queue, PROMOTION, jobInput);
}

/**
 * The job behind a promotion. Every student with a grade in the old year, within the reach of
 * whoever started it, gets the next grade in the org's order in the new year, or what their
 * exception says; one in the last grade gets none. A student who already has a grade in the new
 * year keeps it, so the job can run again safely (D-017).
 */
export async function promoteStudents(ctx: JobContext): Promise<PromotionResult> {
  const input = ctx.input as PromotionInput;
  const reach: repo.Reach = input.branchIds ? { branchIds: input.branchIds } : {};
  const [current, next, grades] = await Promise.all([
    repo.gradesInYear(ctx, input.fromAcademicYearId, reach),
    repo.gradesInYear(ctx, input.toAcademicYearId, {}),
    curriculum.listGradeLevels(ctx),
  ]);
  const order = grades.data.toSorted((a, b) => a.sortOrder - b.sortOrder).map((g) => g.id);
  const exceptionOf = new Map(input.exceptions.map((e) => [e.studentId, e.gradeLevelId]));
  const already = new Set(next.map((g) => g.studentId));
  const result: PromotionResult = {
    fromAcademicYearId: input.fromAcademicYearId,
    toAcademicYearId: input.toAcademicYearId,
    promoted: 0,
    exceptions: 0,
    finished: 0,
    alreadySet: 0,
  };
  const rows: (repo.NewGradeRow & { id: string })[] = [];
  for (const { studentId, gradeLevelId } of current) {
    if (already.has(studentId)) {
      result.alreadySet++;
      continue;
    }
    let target: string | null;
    if (exceptionOf.has(studentId)) {
      target = exceptionOf.get(studentId) ?? null;
      if (target) result.exceptions++;
    } else {
      const at = order.indexOf(gradeLevelId);
      target = at >= 0 && at + 1 < order.length ? order[at + 1]! : null;
      if (target) result.promoted++;
    }
    if (!target) {
      result.finished++;
      continue;
    }
    rows.push({
      id: newId('studentGrade'),
      orgId: ctx.orgId,
      studentId,
      academicYearId: input.toAcademicYearId,
      gradeLevelId: target,
    });
  }
  await ctx.setProgress(50);
  if (rows.length > 0) {
    await repo.insertGrades(ctx, rows, { entityId: ctx.jobId, after: { ...result } });
  }
  return result;
}
