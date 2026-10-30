import {
  addMonths,
  CONSENT_TYPES,
  localNow,
  newId,
  type ConsentType,
  type FamilyErased,
  type SetConsent,
  type StudentConsents,
} from '@edustrux/shared';
import { writeWithAudit, type Access, type OrgCtx } from '../../db/scope';
import { notFound, unprocessable, validationFailed } from '../../lib/errors';
import * as admissions from '../admissions/service';
import * as attendance from '../attendance/service';
import * as billing from '../billing/service';
import * as classes from '../classes/service';
import * as comms from '../comms/service';
import * as enrolment from '../enrolment/service';
import * as learning from '../learning/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as platform from '../platform/service';
import * as staff from '../staff/service';

// Privacy controls (TUI-79): consents per student, and erasing a family. Each module builds its
// own part of an erasure; this puts them in one batch with one audit row. The daily cron erases
// inactive families, and deletes erased ones for good once the org's retention has passed
// (TUI-118).

/** A family is erased this many months after it goes inactive (D-171). Fixed, not a setting. */
export const INACTIVE_MONTHS = 6;

/**
 * The most families the daily cron erases, and the most it deletes, in one org in one night. The
 * rest wait for the next night, so one org's backlog can't use up the cron's D1 calls.
 */
export const FAMILIES_PER_NIGHT = 20;

type ConsentRow = Awaited<ReturnType<typeof people.consentsOf>>['consents'][number];

function toConsents(studentId: string, rows: ConsentRow[]): StudentConsents {
  return {
    studentId,
    consents: CONSENT_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      return {
        type,
        granted: row ? row.granted : null,
        guardianId: row?.guardianId ?? null,
        note: row?.note ?? null,
        recordedByUserId: row?.recordedByUserId ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  };
}

/** Every consent type for the student: what was recorded, or `granted: null` if not asked. */
export async function getConsents(ctx: OrgCtx, access: Access, studentId: string) {
  const { consents } = await people.consentsOf(ctx, access, studentId);
  return toConsents(studentId, consents);
}

/**
 * Records a consent given or refused. Staff may name the guardian who gave it; a parent gives it
 * as their own guardian in the student's family. One read stage, then the write.
 */
export async function setConsent(
  ctx: OrgCtx,
  access: Access,
  studentId: string,
  type: ConsentType,
  input: SetConsent,
) {
  const [{ consents }, guardians] = await Promise.all([
    people.consentsOf(ctx, access, studentId),
    people.guardiansOfStudent(ctx, studentId),
  ]);
  let guardianId = input.guardianId ?? null;
  if (access.role === 'parent') {
    const own = guardians.find((g) => g.membershipId === access.membershipId);
    if (!own) throw notFound('Student');
    guardianId = own.id;
  } else if (guardianId && !guardians.some((g) => g.id === guardianId)) {
    throw validationFailed({ guardianId: ['Not one of the student’s family’s guardians'] });
  }
  const before = consents.find((c) => c.type === type);
  const saved = await people.saveConsent(ctx, before, {
    id: before?.id ?? newId('studentConsent'),
    orgId: ctx.orgId,
    studentId,
    type,
    granted: input.granted,
    guardianId,
    note: input.note ?? null,
    recordedByUserId: ctx.actorUserId,
  });
  return toConsents(studentId, [...consents.filter((c) => c.type !== type), saved]);
}

/**
 * Erases a family for good: its, its guardians' and its students' names and details are
 * replaced or cleared, everywhere they were copied, and the audit log's copies with them. Ids,
 * the bank reference, invoices, payments and attendance stay, so the books still add up. A family
 * that still owes money or has enrolments running is refused. Erasing twice changes nothing.
 * Owner only (the route's permission).
 */
export async function eraseFamily(ctx: OrgCtx, id: string): Promise<FamilyErased> {
  const org = await orgs.getOrg(ctx);
  return erase(ctx, id, localNow(org.timezone).date, false);
}

async function erase(ctx: OrgCtx, id: string, today: string, auto: boolean): Promise<FamilyErased> {
  const [family, who, owed] = await Promise.all([
    people.familyToErase(ctx, id),
    people.peopleOfFamily(ctx, id),
    billing.owedBy(ctx, id),
  ]);
  if (!family) throw notFound('Family');
  const counts = { guardians: who.guardianIds.length, students: who.studentIds.length };
  if (family.erasedAt) return { familyId: id, erasedAt: family.erasedAt, ...counts };
  if (owed > 0) {
    throw unprocessable('The family still owes money: settle or void its invoices first.', {
      familyId: ['Unpaid invoices'],
    });
  }
  if ((await enrolment.continuing(ctx, who.studentIds, today)) > 0) {
    throw unprocessable('The family’s students are still enrolled: withdraw them first.', {
      familyId: ['Enrolments running'],
    });
  }

  const at = new Date().toISOString();
  await writeWithAudit(
    ctx,
    [
      ...people.eraseStatements(ctx, id, who.studentIds, at),
      ...attendance.eraseStatements(ctx, who.studentIds),
      ...learning.eraseStatements(ctx, who.studentIds),
      ...staff.eraseStatements(ctx, who.guardianIds),
      ...admissions.eraseStatements(ctx, id),
      ...platform.eraseAuditStatements(ctx, [id, ...who.guardianIds, ...who.studentIds]),
    ],
    {
      action: 'family.erased',
      entityType: 'family',
      entityId: id,
      after: auto ? { ...counts, auto: true } : counts,
    },
  );
  return { familyId: id, erasedAt: at, ...counts };
}

/**
 * Erases the org's inactive families, as `POST /families/{id}/erase` does, with `auto: true` on
 * each audit row (TUI-118, D-171). Inactive: made more than 6 months ago, no enrolment running or
 * ending in the last 6 months, no lesson marked in them, nothing owed, and no invoice or payment
 * in them. Deleted families count too. Returns how many were erased.
 */
export async function eraseInactive(ctx: OrgCtx, today: string): Promise<number> {
  const since = addMonths(today, -INACTIVE_MONTHS);
  const ids = await people.inactiveFamilies(
    ctx,
    since,
    [
      enrolment.studentsEnrolledSince(ctx, since),
      attendance.studentsMarkedIn(ctx, classes.sessionsSince(ctx, since)),
    ],
    billing.familiesWithMoneySince(ctx, since),
    FAMILIES_PER_NIGHT,
  );
  let erased = 0;
  for (const id of ids) {
    try {
      await erase(ctx, id, today, true);
      erased++;
    } catch (err) {
      console.error(`daily cron: erasing family ${id} failed`, err);
    }
  }
  return erased;
}

/**
 * Deletes for good the erased families whose money is older than the org's retention (TUI-118,
 * D-171): no invoice made or ending, and no payment, in the last `years` years, and nothing owed.
 * Everything of the family goes in one batch: its invoices, payments and their allocations, its
 * guardians and students, their enrolments, attendance, make-ups, grades and message rows, and the
 * family row; the audit log's copies of its invoices and payments are cleared. One
 * `family.purged` audit row each. Returns how many families were deleted.
 */
export async function purgeExpired(ctx: OrgCtx, years: number, today: string): Promise<number> {
  const since = addMonths(today, -12 * years);
  const ids = await people.erasedFamiliesExcept(
    ctx,
    billing.familiesWithMoneySince(ctx, since),
    FAMILIES_PER_NIGHT,
  );
  for (const id of ids) {
    const [who, money] = await Promise.all([
      people.peopleOfFamily(ctx, id),
      billing.moneyOf(ctx, id),
    ]);
    await writeWithAudit(
      ctx,
      [
        ...billing.purgeStatements(ctx, money),
        ...enrolment.purgeStatements(ctx, who.studentIds),
        ...attendance.purgeStatements(ctx, who.studentIds),
        ...learning.eraseStatements(ctx, who.studentIds),
        ...comms.purgeStatements(ctx, id),
        ...staff.eraseStatements(ctx, who.guardianIds),
        ...platform.eraseAuditStatements(ctx, [...money.invoiceIds, ...money.paymentIds]),
        ...people.purgeStatements(ctx, id, who.studentIds),
      ],
      {
        action: 'family.purged',
        entityType: 'family',
        entityId: id,
        after: {
          guardians: who.guardianIds.length,
          students: who.studentIds.length,
          invoices: money.invoiceIds.length,
          payments: money.paymentIds.length,
        },
      },
    );
  }
  return ids.length;
}
