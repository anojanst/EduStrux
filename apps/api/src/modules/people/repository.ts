import { families, guardians, now, studentGrades, students } from '@edustrux/db';
import { and, asc, count, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type FamilyRow = typeof families.$inferSelect;
export type NewFamilyRow = typeof families.$inferInsert;
export type FamilyChanges = Partial<
  Pick<NewFamilyRow, 'name' | 'nameNorm' | 'branchId' | 'address' | 'billingGuardianId'>
>;
export type GuardianRow = typeof guardians.$inferSelect;
export type NewGuardianRow = typeof guardians.$inferInsert;
export type GuardianChanges = Partial<
  Omit<NewGuardianRow, 'id' | 'orgId' | 'familyId' | 'membershipId' | 'createdAt' | 'deletedAt'>
>;
export type StudentRow = typeof students.$inferSelect;
export type NewStudentRow = typeof students.$inferInsert;
export type StudentChanges = Partial<
  Pick<
    NewStudentRow,
    'firstName' | 'lastName' | 'firstNameNorm' | 'lastNameNorm' | 'dateOfBirth' | 'notes'
  >
>;
export type GradeRow = typeof studentGrades.$inferSelect;
export type NewGradeRow = typeof studentGrades.$inferInsert;

/**
 * The part of the org's families a caller may see or change: every family when empty, else only
 * those whose home branch is in `branchIds`, or that have a guardian signed in as
 * `guardianMembershipId`, or none at all. Guardians and students are reached through their family.
 */
export type Reach = { branchIds?: string[]; guardianMembershipId?: string; nothing?: true };

export type StudentFilter = {
  familyId?: string;
  branchId?: string;
  /** Only students with this grade level in this academic year. */
  grade?: { academicYearId: string; gradeLevelId: string };
};

/**
 * A student's grade for one academic year, to write: `gradeLevelId: null` removes it. `existing`
 * is the row on record for that year, and `newId` the id to use when there isn't one.
 */
export type GradeChange = {
  academicYearId: string;
  gradeLevelId: string | null;
  existing: GradeRow | undefined;
  newId: string;
};

function within(ctx: OrgCtx, reach: Reach): SQL | undefined {
  if (reach.nothing) return sql`0`;
  return and(
    reach.branchIds ? inIds(families.branchId, reach.branchIds) : undefined,
    reach.guardianMembershipId
      ? sql`${families.id} in (select ${guardians.familyId} from ${guardians} where ${guardians.orgId} = ${ctx.orgId} and ${guardians.membershipId} = ${reach.guardianMembershipId} and ${guardians.deletedAt} is null)`
      : undefined,
  );
}

// ── Families ────────────────────────────────────────────────────────────────

/** In name, then id order. Fetches `limit + 1` rows to tell if there's another page. */
export function listFamilies(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: { branchId?: string },
  reach: Reach,
) {
  const [name, id] = after ?? [];
  return ctx.db
    .select()
    .from(families)
    .where(
      inOrg(
        ctx,
        families,
        filter.branchId ? eq(families.branchId, filter.branchId) : undefined,
        within(ctx, reach),
        name !== undefined && id !== undefined
          ? or(gt(families.nameNorm, name), and(eq(families.nameNorm, name), gt(families.id, id)))
          : undefined,
      ),
    )
    .orderBy(asc(families.nameNorm), asc(families.id))
    .limit(limit + 1);
}

export function findFamily(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(families)
    .where(inOrg(ctx, families, eq(families.id, id), within(ctx, reach)))
    .get();
}

/** How many families have this home branch. A branch can't be deleted while any do. */
export async function countFamilies(ctx: OrgCtx, branchId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(families)
    .where(inOrg(ctx, families, eq(families.branchId, branchId)))
    .get();
  return row?.n ?? 0;
}

export async function insertFamily(ctx: OrgCtx, row: NewFamilyRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(families).values(row)], {
    action: 'family.created',
    entityType: 'family',
    entityId: row.id,
    after: row,
  });
}

export async function updateFamily(ctx: OrgCtx, before: FamilyRow, changes: FamilyChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(families)
        .set(changes)
        .where(inOrg(ctx, families, eq(families.id, before.id))),
    ],
    { action: 'family.updated', entityType: 'family', entityId: before.id, before, after: changes },
  );
}

/** Soft-deletes the family and its guardians. The caller makes sure it has no students. */
export async function softDeleteFamily(ctx: OrgCtx, before: FamilyRow) {
  const deletedAt = now();
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(families)
        .set({ deletedAt })
        .where(inOrg(ctx, families, eq(families.id, before.id))),
      ctx.db
        .update(guardians)
        .set({ deletedAt })
        .where(inOrg(ctx, guardians, eq(guardians.familyId, before.id))),
    ],
    { action: 'family.deleted', entityType: 'family', entityId: before.id, before },
  );
}

// ── Guardians ───────────────────────────────────────────────────────────────

/** The guardians of the given families, each family's oldest first. */
export function listGuardians(ctx: OrgCtx, familyIds: string[]) {
  return ctx.db
    .select()
    .from(guardians)
    .where(inOrg(ctx, guardians, inIds(guardians.familyId, familyIds)))
    .orderBy(asc(guardians.familyId), asc(guardians.id));
}

/** A guardian with their family, if the family is within reach. */
export function findGuardian(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select({ guardian: guardians, family: families })
    .from(guardians)
    .innerJoin(families, eq(families.id, guardians.familyId))
    .where(
      and(inOrg(ctx, guardians, eq(guardians.id, id)), inOrg(ctx, families, within(ctx, reach))),
    )
    .get();
}

/** `billing` also makes the new guardian the family's billing contact, in the same batch. */
export async function insertGuardian(
  ctx: OrgCtx,
  row: NewGuardianRow & { id: string },
  billing: boolean,
) {
  await writeWithAudit(
    ctx,
    [
      ctx.db.insert(guardians).values(row),
      ...(billing
        ? [
            ctx.db
              .update(families)
              .set({ billingGuardianId: row.id })
              .where(inOrg(ctx, families, eq(families.id, row.familyId))),
          ]
        : []),
    ],
    {
      action: 'guardian.created',
      entityType: 'guardian',
      entityId: row.id,
      after: { ...row, billingContact: billing },
    },
  );
}

export async function updateGuardian(ctx: OrgCtx, before: GuardianRow, changes: GuardianChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(guardians)
        .set(changes)
        .where(inOrg(ctx, guardians, eq(guardians.id, before.id))),
    ],
    {
      action: 'guardian.updated',
      entityType: 'guardian',
      entityId: before.id,
      before,
      after: changes,
    },
  );
}

export async function softDeleteGuardian(ctx: OrgCtx, before: GuardianRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(guardians)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, guardians, eq(guardians.id, before.id))),
    ],
    { action: 'guardian.deleted', entityType: 'guardian', entityId: before.id, before },
  );
}

// ── Students ────────────────────────────────────────────────────────────────

// A student is read with their family's home branch.
const studentWithBranch = { student: students, branchId: families.branchId };

/** In last name, first name, then id order. Fetches `limit + 1` rows to tell if there's more. */
export function listStudents(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: StudentFilter,
  reach: Reach,
) {
  const [last, first, id] = after ?? [];
  const afterCursor =
    last !== undefined && first !== undefined && id !== undefined
      ? or(
          gt(students.lastNameNorm, last),
          and(eq(students.lastNameNorm, last), gt(students.firstNameNorm, first)),
          and(
            eq(students.lastNameNorm, last),
            eq(students.firstNameNorm, first),
            gt(students.id, id),
          ),
        )
      : undefined;
  const inGrade = filter.grade
    ? sql`exists (select 1 from ${studentGrades} where ${studentGrades.orgId} = ${ctx.orgId} and ${studentGrades.studentId} = ${students.id} and ${studentGrades.academicYearId} = ${filter.grade.academicYearId} and ${studentGrades.gradeLevelId} = ${filter.grade.gradeLevelId} and ${studentGrades.deletedAt} is null)`
    : undefined;
  return ctx.db
    .select(studentWithBranch)
    .from(students)
    .innerJoin(families, eq(families.id, students.familyId))
    .where(
      and(
        inOrg(
          ctx,
          students,
          filter.familyId ? eq(students.familyId, filter.familyId) : undefined,
          inGrade,
          afterCursor,
        ),
        inOrg(
          ctx,
          families,
          filter.branchId ? eq(families.branchId, filter.branchId) : undefined,
          within(ctx, reach),
        ),
      ),
    )
    .orderBy(asc(students.lastNameNorm), asc(students.firstNameNorm), asc(students.id))
    .limit(limit + 1);
}

export function findStudent(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select(studentWithBranch)
    .from(students)
    .innerJoin(families, eq(families.id, students.familyId))
    .where(and(inOrg(ctx, students, eq(students.id, id)), inOrg(ctx, families, within(ctx, reach))))
    .get();
}

/** The students of the given families, in name order. */
export function studentsOfFamilies(ctx: OrgCtx, familyIds: string[]) {
  return ctx.db
    .select()
    .from(students)
    .where(inOrg(ctx, students, inIds(students.familyId, familyIds)))
    .orderBy(asc(students.lastNameNorm), asc(students.firstNameNorm), asc(students.id));
}

export async function countStudents(ctx: OrgCtx, familyId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(students)
    .where(inOrg(ctx, students, eq(students.familyId, familyId)))
    .get();
  return row?.n ?? 0;
}

/** `grade` is the student's grade level for one academic year, written in the same batch. */
export async function insertStudent(
  ctx: OrgCtx,
  row: NewStudentRow & { id: string },
  grade: (NewGradeRow & { id: string }) | null,
) {
  await writeWithAudit(
    ctx,
    [
      ctx.db.insert(students).values(row),
      ...(grade ? [ctx.db.insert(studentGrades).values(grade)] : []),
    ],
    {
      action: 'student.created',
      entityType: 'student',
      entityId: row.id,
      after: {
        ...row,
        grade: grade && {
          academicYearId: grade.academicYearId,
          gradeLevelId: grade.gradeLevelId,
        },
      },
    },
  );
}

/** Sets, changes or removes the student's grade for one academic year. */
function gradeStatement(ctx: OrgCtx, studentId: string, grade: GradeChange): BatchItem<'sqlite'> {
  if (!grade.existing) {
    return ctx.db.insert(studentGrades).values({
      id: grade.newId,
      orgId: ctx.orgId,
      studentId,
      academicYearId: grade.academicYearId,
      gradeLevelId: grade.gradeLevelId!,
    });
  }
  return ctx.db
    .update(studentGrades)
    .set(grade.gradeLevelId ? { gradeLevelId: grade.gradeLevelId } : { deletedAt: now() })
    .where(inOrg(ctx, studentGrades, eq(studentGrades.id, grade.existing.id)));
}

/**
 * Updates the student and, in the same batch, their grade for one academic year. The student
 * row is always written, so `updatedAt` moves even when only the grade changes.
 */
export async function updateStudent(
  ctx: OrgCtx,
  before: StudentRow,
  changes: StudentChanges,
  grade: GradeChange | undefined,
) {
  const pair = (gradeLevelId: string | null) =>
    grade && { academicYearId: grade.academicYearId, gradeLevelId };
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(students)
        .set({ ...changes, updatedAt: now() })
        .where(inOrg(ctx, students, eq(students.id, before.id))),
      ...(grade ? [gradeStatement(ctx, before.id, grade)] : []),
    ],
    {
      action: 'student.updated',
      entityType: 'student',
      entityId: before.id,
      before: grade ? { ...before, grade: pair(grade.existing?.gradeLevelId ?? null) } : before,
      after: grade ? { ...changes, grade: pair(grade.gradeLevelId) } : changes,
    },
  );
}

/** Soft-deletes the student and their grade history. */
export async function softDeleteStudent(ctx: OrgCtx, before: StudentRow) {
  const deletedAt = now();
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(students)
        .set({ deletedAt })
        .where(inOrg(ctx, students, eq(students.id, before.id))),
      ctx.db
        .update(studentGrades)
        .set({ deletedAt })
        .where(inOrg(ctx, studentGrades, eq(studentGrades.studentId, before.id))),
    ],
    { action: 'student.deleted', entityType: 'student', entityId: before.id, before },
  );
}

// ── Student grades ──────────────────────────────────────────────────────────

/** Every grade on record for the given students. */
export function listGrades(ctx: OrgCtx, studentIds: string[]) {
  return ctx.db
    .select()
    .from(studentGrades)
    .where(inOrg(ctx, studentGrades, inIds(studentGrades.studentId, studentIds)));
}

export function findGrade(ctx: OrgCtx, studentId: string, academicYearId: string) {
  return ctx.db
    .select()
    .from(studentGrades)
    .where(
      inOrg(
        ctx,
        studentGrades,
        eq(studentGrades.studentId, studentId),
        eq(studentGrades.academicYearId, academicYearId),
      ),
    )
    .get();
}

/** How many students have been in this grade level, in any year. It can't be deleted while any have. */
export async function countStudentsInGrade(ctx: OrgCtx, gradeLevelId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(studentGrades)
    .where(inOrg(ctx, studentGrades, eq(studentGrades.gradeLevelId, gradeLevelId)))
    .get();
  return row?.n ?? 0;
}
