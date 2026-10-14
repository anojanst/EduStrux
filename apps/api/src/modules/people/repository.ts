import { families, guardians, now, studentGrades, students } from '@edustrux/db';
import { and, asc, count, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  changedFields,
  firstIds,
  idsFrom,
  inIds,
  inOrg,
  wide,
  writeWithAudit,
  type IdQuery,
  type Ids,
  type OrgCtx,
} from '../../db/scope';

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
 * `guardianMembershipId`. Guardians and students are reached through their family. `studentIds`
 * narrows to those students alone, with their families and guardians but not their siblings.
 */
export type Reach = { branchIds?: string[]; guardianMembershipId?: string; studentIds?: Ids };

export type StudentFilter = {
  familyId?: string;
  branchId?: string;
  /**
   * Only students with this grade level in this academic year. The year can be a query for its
   * id: the current year, which the calendar works out inside the statement.
   */
  grade?: { academicYearId: string | IdQuery; gradeLevelId: string };
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

/** The families a guardian signed in with this membership belongs to. */
const familiesOfGuardian = (ctx: OrgCtx, membershipId: string) =>
  idsFrom(ctx, guardians, guardians.familyId, eq(guardians.membershipId, membershipId));

/** The families of these students. */
const familiesOfStudents = (ctx: OrgCtx, studentIds: Ids) =>
  idsFrom(ctx, students, students.familyId, inIds(students.id, studentIds));

/**
 * The reach as separate conditions on families, for `inOrg` to find ids to go to among them. A
 * parent's or a teacher's families are a few ids. The families of some branches are a big share
 * of the org, so those are wrapped in `and()` and only ever checked, row by row.
 */
const familyReach = (ctx: OrgCtx, reach: Reach) => [
  reach.branchIds ? and(inIds(families.branchId, reach.branchIds)) : undefined,
  reach.guardianMembershipId
    ? inIds(families.id, familiesOfGuardian(ctx, reach.guardianMembershipId))
    : undefined,
  reach.studentIds ? inIds(families.id, familiesOfStudents(ctx, reach.studentIds)) : undefined,
];

/** The reach as one condition on families, which only narrows what the rest of the query finds. */
const within = (ctx: OrgCtx, reach: Reach) => and(...familyReach(ctx, reach));

/** Whether the reach is a few families: a parent's or a teacher's, not a branch's or the org's. */
const fewFamilies = (reach: Reach) =>
  reach.guardianMembershipId !== undefined || reach.studentIds !== undefined;

/** The students of a family within reach that the caller may see: all of them, or `studentIds`. */
const studentWithin = (reach: Reach) =>
  reach.studentIds ? inIds(students.id, reach.studentIds) : undefined;

/**
 * The reach as separate conditions on students, for `inOrg` to find ids to go to among them: a
 * parent's children by their families, and a teacher's students by id. The family each student
 * is read with is checked by `within` as well.
 */
const studentReach = (ctx: OrgCtx, reach: Reach) => [
  reach.guardianMembershipId
    ? inIds(students.familyId, familiesOfGuardian(ctx, reach.guardianMembershipId))
    : undefined,
  studentWithin(reach),
];

// ── Families ────────────────────────────────────────────────────────────────

export type FamilyFilter = { branchId?: string };

/** What a page of families is found by: the filter, the reach, and where the last page ended. */
function familyPage(ctx: OrgCtx, after: string[] | undefined, filter: FamilyFilter, reach: Reach) {
  const [name, id] = after ?? [];
  return [
    filter.branchId ? eq(families.branchId, filter.branchId) : undefined,
    ...familyReach(ctx, reach),
    name !== undefined && id !== undefined
      ? or(gt(families.nameNorm, name), and(eq(families.nameNorm, name), gt(families.id, id)))
      : undefined,
  ];
}

/** In name, then id order. Fetches `limit + 1` rows to tell if there's another page. */
export function listFamilies(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: FamilyFilter,
  reach: Reach,
) {
  return ctx.db
    .select()
    .from(families)
    .where(inOrg(ctx, families, ...familyPage(ctx, after, filter, reach)))
    .orderBy(asc(families.nameNorm), asc(families.id))
    .limit(limit + 1);
}

/**
 * The families `listFamilies` puts on that page, as ids: the same conditions in the same order.
 * What the page shows of guardians, students and grades is read by them, in the same stage as
 * the page itself (D-104).
 */
export function familiesOnPage(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: FamilyFilter,
  reach: Reach,
): IdQuery {
  return firstIds(
    idsFrom(ctx, families, families.id, ...familyPage(ctx, after, filter, reach)),
    limit,
    asc(families.nameNorm),
    asc(families.id),
  );
}

/** What one family is found by: its id, if it is within reach. */
const oneFamily = (ctx: OrgCtx, id: string, reach: Reach) => [
  eq(families.id, id),
  within(ctx, reach),
];

export function findFamily(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(families)
    .where(inOrg(ctx, families, ...oneFamily(ctx, id, reach)))
    .get();
}

/**
 * The family `findFamily` returns, as an id: none when it is outside the reach. What the family
 * is shown with is read by it, in the same stage as the family (D-104), so nothing of a family
 * the caller can't see is read at all.
 */
export function familyFound(ctx: OrgCtx, id: string, reach: Reach): IdQuery {
  return idsFrom(ctx, families, families.id, ...oneFamily(ctx, id, reach));
}

/** The ids of every family within reach. */
export async function familyIds(ctx: OrgCtx, reach: Reach) {
  const rows = await ctx.db
    .select({ id: families.id })
    .from(families)
    .where(inOrg(ctx, families, within(ctx, reach)));
  return rows.map((row) => row.id);
}

/**
 * Every family within reach, as ids to filter another table by. The families of some branches
 * are `wide`: a statement checks its rows against them and never reads them all.
 */
export function familiesWithin(ctx: OrgCtx, reach: Reach): IdQuery {
  if (fewFamilies(reach)) return idsFrom(ctx, families, families.id, ...familyReach(ctx, reach));
  const inBranches = reach.branchIds ? inIds(families.branchId, reach.branchIds) : undefined;
  return wide(idsFrom(ctx, families, families.id, inBranches));
}

/** What a record that points at a family shows of it. */
export function familyLabels(ctx: OrgCtx, ids: Ids) {
  return ctx.db
    .select({
      id: families.id,
      name: families.name,
      branchId: families.branchId,
      bankReference: families.bankReference,
    })
    .from(families)
    .where(inOrg(ctx, families, inIds(families.id, ids)));
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

/** Returns the family as stored, from the same batch, so the caller doesn't read it back. */
export async function insertFamily(
  ctx: OrgCtx,
  row: NewFamilyRow & { id: string },
): Promise<FamilyRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(families).values(row).returning()],
    { action: 'family.created', entityType: 'family', entityId: row.id, after: row },
  );
  const stored = (inserted as FamilyRow[])[0];
  if (!stored) throw new Error('Family missing after insert');
  return stored;
}

/** Returns the family as updated, from the same batch, or undefined if it was just deleted. */
export async function updateFamily(
  ctx: OrgCtx,
  before: FamilyRow,
  changes: FamilyChanges,
): Promise<FamilyRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(families)
        .set(changes)
        .where(inOrg(ctx, families, eq(families.id, before.id)))
        .returning(),
    ],
    {
      action: 'family.updated',
      entityType: 'family',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as FamilyRow[])[0];
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
export function listGuardians(ctx: OrgCtx, familyIds: Ids) {
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

/**
 * `billing` also makes the new guardian the family's billing contact, in the same batch. Returns
 * the guardian as stored, from that batch.
 */
export async function insertGuardian(
  ctx: OrgCtx,
  row: NewGuardianRow & { id: string },
  billing: boolean,
): Promise<GuardianRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [
      ctx.db.insert(guardians).values(row).returning(),
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
  const stored = (inserted as GuardianRow[])[0];
  if (!stored) throw new Error('Guardian missing after insert');
  return stored;
}

/** Returns the guardian as updated, from the same batch, or undefined if it was just deleted. */
export async function updateGuardian(
  ctx: OrgCtx,
  before: GuardianRow,
  changes: GuardianChanges,
): Promise<GuardianRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(guardians)
        .set(changes)
        .where(inOrg(ctx, guardians, eq(guardians.id, before.id)))
        .returning(),
    ],
    {
      action: 'guardian.updated',
      entityType: 'guardian',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as GuardianRow[])[0];
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

/**
 * What a student's family must meet, as a condition on the student. A read that joins students
 * to their families states it in the join. A query for student ids has no join, so it looks
 * each student's family up, one row at a time, and never reads the families as a list.
 */
const whoseFamily = (ctx: OrgCtx, ofFamily: (SQL | undefined)[]) =>
  inIds(students.familyId, wide(idsFrom(ctx, families, families.id, ...ofFamily)));

/**
 * What a page of students is found by: the filter, the reach, and where the last page ended.
 * `ofStudent` is what the student's own row must meet, and `ofFamily` what their family's must.
 */
function studentPage(
  ctx: OrgCtx,
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
  const year = filter.grade?.academicYearId;
  const inYear =
    typeof year === 'string'
      ? eq(studentGrades.academicYearId, year)
      : year && inIds(studentGrades.academicYearId, year);
  const inGrade = filter.grade
    ? sql`exists (select 1 from ${studentGrades} where ${studentGrades.orgId} = ${ctx.orgId} and ${studentGrades.studentId} = ${students.id} and ${inYear} and ${studentGrades.gradeLevelId} = ${filter.grade.gradeLevelId} and ${studentGrades.deletedAt} is null)`
    : undefined;
  return {
    ofStudent: [
      filter.familyId ? eq(students.familyId, filter.familyId) : undefined,
      inGrade,
      ...studentReach(ctx, reach),
      afterCursor,
    ],
    ofFamily: [
      filter.branchId ? eq(families.branchId, filter.branchId) : undefined,
      within(ctx, reach),
    ],
  };
}

/** In last name, first name, then id order. Fetches `limit + 1` rows to tell if there's more. */
export function listStudents(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: StudentFilter,
  reach: Reach,
) {
  const { ofStudent, ofFamily } = studentPage(ctx, after, filter, reach);
  return ctx.db
    .select(studentWithBranch)
    .from(students)
    .innerJoin(families, eq(families.id, students.familyId))
    .where(and(inOrg(ctx, students, ...ofStudent), inOrg(ctx, families, ...ofFamily)))
    .orderBy(asc(students.lastNameNorm), asc(students.firstNameNorm), asc(students.id))
    .limit(limit + 1);
}

/**
 * The students `listStudents` puts on that page, as ids: the same conditions in the same order.
 * Their grades are read by them, in the same stage as the page itself (D-104). It is read in the
 * page's order too.
 */
export function studentsOnPage(
  ctx: OrgCtx,
  limit: number,
  after: string[] | undefined,
  filter: StudentFilter,
  reach: Reach,
): IdQuery {
  const { ofStudent, ofFamily } = studentPage(ctx, after, filter, reach);
  return firstIds(
    idsFrom(ctx, students, students.id, ...ofStudent, whoseFamily(ctx, ofFamily)),
    limit,
    asc(students.lastNameNorm),
    asc(students.firstNameNorm),
    asc(students.id),
  );
}

/**
 * What one student is found by: their id, if they are within reach. `ofStudent` is what the
 * student's own row must meet, and `ofFamily` what their family's must.
 */
const oneStudent = (ctx: OrgCtx, id: string, reach: Reach) => ({
  ofStudent: [eq(students.id, id), studentWithin(reach)],
  ofFamily: [within(ctx, reach)],
});

export function findStudent(ctx: OrgCtx, id: string, reach: Reach) {
  const { ofStudent, ofFamily } = oneStudent(ctx, id, reach);
  return ctx.db
    .select(studentWithBranch)
    .from(students)
    .innerJoin(families, eq(families.id, students.familyId))
    .where(and(inOrg(ctx, students, ...ofStudent), inOrg(ctx, families, ...ofFamily)))
    .get();
}

/**
 * The student `findStudent` returns, as an id: none when they are outside the reach. Their
 * grades are read by it, in the same stage as the student (D-104), so nothing of a student the
 * caller can't see is read at all.
 */
export function studentFound(ctx: OrgCtx, id: string, reach: Reach): IdQuery {
  const { ofStudent, ofFamily } = oneStudent(ctx, id, reach);
  return idsFrom(ctx, students, students.id, ...ofStudent, whoseFamily(ctx, ofFamily));
}

/** What the students of the given families that are within reach are found by. */
const ofFamilies = (familyIds: Ids, reach: Reach) => [
  inIds(students.familyId, familyIds),
  studentWithin(reach),
];

/** The students of the given families that are within reach, in name order. */
export function studentsOfFamilies(ctx: OrgCtx, familyIds: Ids, reach: Reach) {
  return ctx.db
    .select()
    .from(students)
    .where(inOrg(ctx, students, ...ofFamilies(familyIds, reach)))
    .orderBy(asc(students.lastNameNorm), asc(students.firstNameNorm), asc(students.id));
}

/**
 * The students `studentsOfFamilies` returns, as ids: their grades are read by them, in the same
 * stage as the students themselves (D-104).
 */
export function studentIdsOfFamilies(ctx: OrgCtx, familyIds: Ids, reach: Reach): IdQuery {
  return idsFrom(ctx, students, students.id, ...ofFamilies(familyIds, reach));
}

/** The ids of every student within reach. */
export async function studentIds(ctx: OrgCtx, reach: Reach) {
  const rows = await ctx.db
    .select({ id: students.id })
    .from(students)
    .innerJoin(families, eq(families.id, students.familyId))
    .where(and(inOrg(ctx, students), inOrg(ctx, families, within(ctx, reach))));
  return rows.map((row) => row.id);
}

/**
 * Every student within reach, as ids to filter another table by: the students of the families
 * within reach. Wide when those are.
 */
export function studentsWithin(ctx: OrgCtx, reach: Reach): IdQuery {
  const ids = idsFrom(
    ctx,
    students,
    students.id,
    inIds(students.familyId, familiesWithin(ctx, reach)),
    studentWithin(reach),
  );
  return fewFamilies(reach) ? ids : wide(ids);
}

/** The family of each of the given students. */
export function studentFamilies(ctx: OrgCtx, ids: Ids) {
  return ctx.db
    .select({ id: students.id, familyId: students.familyId })
    .from(students)
    .where(inOrg(ctx, students, inIds(students.id, ids)));
}

/** The names of the given students. */
export function studentNames(ctx: OrgCtx, ids: Ids) {
  return ctx.db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
    .from(students)
    .where(inOrg(ctx, students, inIds(students.id, ids)));
}

export async function countStudents(ctx: OrgCtx, familyId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(students)
    .where(inOrg(ctx, students, eq(students.familyId, familyId)))
    .get();
  return row?.n ?? 0;
}

/**
 * `grade` is the student's grade level for one academic year, written in the same batch. Returns
 * the student as stored, from that batch.
 */
export async function insertStudent(
  ctx: OrgCtx,
  row: NewStudentRow & { id: string },
  grade: (NewGradeRow & { id: string }) | null,
): Promise<StudentRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [
      ctx.db.insert(students).values(row).returning(),
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
  const stored = (inserted as StudentRow[])[0];
  if (!stored) throw new Error('Student missing after insert');
  return stored;
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
 * row is always written, so `updatedAt` moves even when only the grade changes. Returns the
 * student as updated, from that batch, or undefined if they were just deleted.
 */
export async function updateStudent(
  ctx: OrgCtx,
  before: StudentRow,
  changes: StudentChanges,
  grade: GradeChange | undefined,
): Promise<StudentRow | undefined> {
  const pair = (gradeLevelId: string | null) =>
    grade && { academicYearId: grade.academicYearId, gradeLevelId };
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(students)
        .set({ ...changes, updatedAt: now() })
        .where(inOrg(ctx, students, eq(students.id, before.id)))
        .returning(),
      ...(grade ? [gradeStatement(ctx, before.id, grade)] : []),
    ],
    {
      action: 'student.updated',
      entityType: 'student',
      entityId: before.id,
      ...changedFields(
        grade ? { ...before, grade: pair(grade.existing?.gradeLevelId ?? null) } : before,
        grade ? { ...changes, grade: pair(grade.gradeLevelId) } : changes,
      ),
    },
  );
  return (updated as StudentRow[])[0];
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
export function listGrades(ctx: OrgCtx, studentIds: Ids) {
  return ctx.db
    .select()
    .from(studentGrades)
    .where(inOrg(ctx, studentGrades, inIds(studentGrades.studentId, studentIds)));
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
