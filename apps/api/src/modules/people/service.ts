import {
  localNow,
  newId,
  normaliseName,
  type AcademicYear,
  type CreateFamily,
  type CreateGuardian,
  type CreateStudent,
  type Family,
  type Guardian,
  type Student,
  type UpdateFamily,
  type UpdateGuardian,
  type UpdateStudent,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import { forbidden, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { byKeys, decodeKeys, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import * as calendar from '../calendar/service';
import * as curriculum from '../curriculum/service';
import * as orgs from '../orgs/service';
import * as repo from './repository';

type Years = { years: AcademicYear[]; current: AcademicYear | null };

export function toGuardian(row: repo.GuardianRow): Guardian {
  const {
    orgId: _org,
    deletedAt: _deleted,
    firstNameNorm: _first,
    lastNameNorm: _last,
    ...guardian
  } = row;
  return guardian;
}

/** `grades` are the student's own rows; they come back in academic-year order. */
export function toStudent(
  row: repo.StudentRow,
  branchId: string,
  grades: repo.GradeRow[],
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
  const position = (grade: repo.GradeRow) => order.get(grade.academicYearId) ?? years.length;
  return {
    ...student,
    branchId,
    gradeLevelId: grades.find((g) => g.academicYearId === current?.id)?.gradeLevelId ?? null,
    grades: [...grades]
      .sort((a, b) => position(a) - position(b))
      .map((g) => ({ academicYearId: g.academicYearId, gradeLevelId: g.gradeLevelId })),
  };
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
 * the students in their classes, which needs enrolments; until those exist a teacher reaches none.
 */
function reachOf(access: Access): repo.Reach {
  switch (access.scope) {
    case 'all':
      return {};
    case 'branch':
      return access.branchIds ? { branchIds: access.branchIds } : {};
    case 'own':
      return access.role === 'parent'
        ? { guardianMembershipId: access.membershipId }
        : { nothing: true };
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

async function findStudentOr404(ctx: OrgCtx, id: string, reach: repo.Reach) {
  const row = await repo.findStudent(ctx, id, reach);
  if (!row) throw notFound('Student');
  return row;
}

/** Students as the API returns them, each with their grade history. */
async function loadStudents(
  ctx: OrgCtx,
  rows: { student: repo.StudentRow; branchId: string }[],
): Promise<Student[]> {
  if (rows.length === 0) return [];
  const [grades, years] = await Promise.all([
    repo.listGrades(
      ctx,
      rows.map((r) => r.student.id),
    ),
    calendar.academicYears(ctx),
  ]);
  return rows.map(({ student, branchId }) =>
    toStudent(
      student,
      branchId,
      grades.filter((g) => g.studentId === student.id),
      years,
    ),
  );
}

/** Families as the API returns them, each with its guardians and students. */
async function loadFamilies(ctx: OrgCtx, rows: repo.FamilyRow[]): Promise<Family[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((f) => f.id);
  const branchOf = new Map(rows.map((f) => [f.id, f.branchId]));
  const [guardians, studentRows] = await Promise.all([
    repo.listGuardians(ctx, ids),
    repo.studentsOfFamilies(ctx, ids),
  ]);
  const students = await loadStudents(
    ctx,
    studentRows.map((student) => ({ student, branchId: branchOf.get(student.familyId)! })),
  );
  return rows.map((family) =>
    toFamily(
      family,
      guardians.filter((g) => g.familyId === family.id),
      students.filter((s) => s.familyId === family.id),
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
  if (filter.branchId) await branches.getBranch(ctx, filter.branchId);
  const rows = await repo.listFamilies(ctx, limit, decodeKeys(cursor, 2), filter, reachOf(access));
  const { data, nextCursor } = toPage(rows, limit, (f) => byKeys(f.nameNorm, f.id));
  return { data: await loadFamilies(ctx, data), nextCursor };
}

export async function getFamily(ctx: OrgCtx, access: Access, id: string): Promise<Family> {
  const row = await findFamilyOr404(ctx, id, reachOf(access));
  return (await loadFamilies(ctx, [row]))[0]!;
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
  await repo.insertFamily(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    nameNorm: normaliseName(input.name),
    branchId: input.branchId,
    address: input.address ?? null,
    billingGuardianId: null,
  });
  return getFamily(ctx, access, id);
}

/** A family can move to another home branch; branch staff only into one of their own. */
export async function updateFamily(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateFamily,
): Promise<Family> {
  const before = await findFamilyOr404(ctx, id, reachOf(access));
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...rest } = input;
  const changes: repo.FamilyChanges = { ...rest };
  if (Object.keys(changes).length === 0) return getFamily(ctx, access, id);

  if (changes.name !== undefined) changes.nameNorm = normaliseName(changes.name);
  if (changes.branchId !== undefined && changes.branchId !== before.branchId) {
    await branches.getBranch(ctx, changes.branchId);
    checkBranchWithinReach(access, changes.branchId);
  }
  if (changes.billingGuardianId && changes.billingGuardianId !== before.billingGuardianId) {
    const guardians = await repo.listGuardians(ctx, [id]);
    if (!guardians.some((g) => g.id === changes.billingGuardianId)) {
      throw unprocessable("The billing contact must be one of the family's guardians.", {
        billingGuardianId: ['Not a guardian of this family'],
      });
    }
  }

  await repo.updateFamily(ctx, before, changes);
  return getFamily(ctx, access, id);
}

/** Deletes the family and its guardians. Refused while the family has students. */
export async function deleteFamily(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const before = await findFamilyOr404(ctx, id, reachOf(access));
  const studentCount = await repo.countStudents(ctx, id);
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
  const reach = reachOf(access);
  const family = await findFamilyOr404(ctx, familyId, reach);

  const id = newId('guardian');
  await repo.insertGuardian(
    ctx,
    {
      id,
      orgId: ctx.orgId,
      familyId,
      firstName: input.firstName,
      lastName: input.lastName,
      firstNameNorm: normaliseName(input.firstName),
      lastNameNorm: normaliseName(input.lastName),
      relationship: input.relationship ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      preferredChannel: input.preferredChannel,
      language: input.language ?? null,
      emergencyContact: input.emergencyContact,
      membershipId: null,
    },
    family.billingGuardianId === null,
  );
  return toGuardian((await findGuardianOr404(ctx, id, reach)).guardian);
}

export async function updateGuardian(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateGuardian,
): Promise<Guardian> {
  const reach = reachOf(access);
  const { guardian: before } = await findGuardianOr404(ctx, id, reach);
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...rest } = input;
  const changes: repo.GuardianChanges = { ...rest };
  if (Object.keys(changes).length === 0) return toGuardian(before);
  if (changes.firstName !== undefined) changes.firstNameNorm = normaliseName(changes.firstName);
  if (changes.lastName !== undefined) changes.lastNameNorm = normaliseName(changes.lastName);

  await repo.updateGuardian(ctx, before, changes);
  return toGuardian((await findGuardianOr404(ctx, id, reach)).guardian);
}

/**
 * The billing contact can't be deleted: another guardian must take over first. So a family's
 * last guardian goes only when the family does.
 */
export async function deleteGuardian(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const { guardian, family } = await findGuardianOr404(ctx, id, reachOf(access));
  if (family.billingGuardianId === guardian.id) {
    throw unprocessable(
      "This guardian is the family's billing contact. Make another guardian the billing contact first.",
    );
  }
  await repo.softDeleteGuardian(ctx, guardian);
}

// ── Students ────────────────────────────────────────────────────────────────

async function checkBirthDate(ctx: OrgCtx, dateOfBirth: string | null | undefined) {
  if (!dateOfBirth) return;
  const { timezone } = await orgs.getOrg(ctx);
  if (dateOfBirth > localNow(timezone).date) {
    throw validationFailed({ dateOfBirth: ['In the future'] });
  }
}

/**
 * The academic year a grade is for: the one named, or the current one. null when the org has no
 * academic years yet, so nobody can have a grade.
 */
async function gradeYear(ctx: OrgCtx, academicYearId: string | undefined) {
  if (academicYearId) return (await calendar.getAcademicYear(ctx, academicYearId)).id;
  return (await calendar.academicYears(ctx)).current?.id ?? null;
}

const noAcademicYear = () =>
  unprocessable('Add an academic year before giving a student a grade level.', {
    gradeLevelId: ['No academic year yet'],
  });

export async function listStudents(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: { familyId?: string; branchId?: string; gradeLevelId?: string; academicYearId?: string },
) {
  const reach = reachOf(access);
  if (query.familyId) await findFamilyOr404(ctx, query.familyId, reach);
  if (query.branchId) await branches.getBranch(ctx, query.branchId);
  let grade: repo.StudentFilter['grade'];
  if (query.gradeLevelId) {
    await curriculum.getGradeLevel(ctx, query.gradeLevelId);
    const academicYearId = await gradeYear(ctx, query.academicYearId);
    if (!academicYearId) return { data: [], nextCursor: null };
    grade = { academicYearId, gradeLevelId: query.gradeLevelId };
  }

  const rows = await repo.listStudents(
    ctx,
    limit,
    decodeKeys(cursor, 3),
    { familyId: query.familyId, branchId: query.branchId, grade },
    reach,
  );
  const { data, nextCursor } = toPage(
    rows.map((row) => ({ ...row, id: row.student.id })),
    limit,
    ({ student }) => byKeys(student.lastNameNorm, student.firstNameNorm, student.id),
  );
  return { data: await loadStudents(ctx, data), nextCursor };
}

export async function getStudent(ctx: OrgCtx, access: Access, id: string): Promise<Student> {
  const row = await findStudentOr404(ctx, id, reachOf(access));
  return (await loadStudents(ctx, [row]))[0]!;
}

export async function createStudent(
  ctx: OrgCtx,
  access: Access,
  input: CreateStudent,
): Promise<Student> {
  await findFamilyOr404(ctx, input.familyId, reachOf(access));
  await checkBirthDate(ctx, input.dateOfBirth);
  let academicYearId: string | null = null;
  if (input.gradeLevelId) {
    await curriculum.getGradeLevel(ctx, input.gradeLevelId);
    academicYearId = await gradeYear(ctx, input.academicYearId);
    if (!academicYearId) throw noAcademicYear();
  }

  const id = newId('student');
  await repo.insertStudent(
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
    input.gradeLevelId && academicYearId
      ? {
          id: newId('studentGrade'),
          orgId: ctx.orgId,
          studentId: id,
          academicYearId,
          gradeLevelId: input.gradeLevelId,
        }
      : null,
  );
  return getStudent(ctx, access, id);
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
  const { student: before } = await findStudentOr404(ctx, id, reachOf(access));
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, gradeLevelId, academicYearId, ...rest } = input;
  const changes: repo.StudentChanges = { ...rest };
  if (changes.firstName !== undefined) changes.firstNameNorm = normaliseName(changes.firstName);
  if (changes.lastName !== undefined) changes.lastNameNorm = normaliseName(changes.lastName);
  await checkBirthDate(ctx, changes.dateOfBirth);

  let grade: repo.GradeChange | undefined;
  if (gradeLevelId !== undefined) {
    if (gradeLevelId) await curriculum.getGradeLevel(ctx, gradeLevelId);
    const yearId = await gradeYear(ctx, academicYearId);
    if (!yearId && gradeLevelId) throw noAcademicYear();
    const existing = yearId ? await repo.findGrade(ctx, id, yearId) : undefined;
    if (yearId && (existing?.gradeLevelId ?? null) !== gradeLevelId) {
      grade = { academicYearId: yearId, gradeLevelId, existing, newId: newId('studentGrade') };
    }
  }
  if (Object.keys(changes).length === 0 && !grade) return getStudent(ctx, access, id);

  await repo.updateStudent(ctx, before, changes, grade);
  return getStudent(ctx, access, id);
}

/** Deletes the student and their grade history. */
export async function deleteStudent(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const { student } = await findStudentOr404(ctx, id, reachOf(access));
  await repo.softDeleteStudent(ctx, student);
}

/** How many students have been in this grade level, in any year. It can't be deleted while any have. */
export function countStudentsInGrade(ctx: OrgCtx, gradeLevelId: string) {
  return repo.countStudentsInGrade(ctx, gradeLevelId);
}
