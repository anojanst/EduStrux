import type {
  AbsenceNotice,
  CreateAbsenceNotice,
  Enrolment,
  Invoice,
  InvoiceStatus,
  PortalChild,
  PortalInvoice,
  PortalSession,
  Session,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import * as attendance from '../attendance/service';
import * as billing from '../billing/service';
import * as classes from '../classes/service';
import * as enrolment from '../enrolment/service';
import * as people from '../people/service';

// The parent portal (D-126): what a signed-in parent sees of their own family. It owns no tables.
// It reads through the modules that own the data, with the parent's own reach, so a parent sees
// here only what those modules' routes already let them read. Every portal route is the
// parent's alone, so `access` is always a parent's.
//
// Each endpoint reads in one stage (D-102): its reads go to D1 together, each finding the
// parent's children or families by a query written into its own statement (D-104).

type Child = Awaited<ReturnType<typeof people.childrenOfGuardian>>[number];

/** A child as the portal shows them: without the notes staff keep on them (D-126). */
function toChild({ student, familyName }: Child, enrolments: Enrolment[]): PortalChild {
  return {
    id: student.id,
    familyId: student.familyId,
    familyName,
    branchId: student.branchId,
    firstName: student.firstName,
    lastName: student.lastName,
    gradeLevelId: student.gradeLevelId,
    enrolments: enrolments.filter((e) => e.studentId === student.id),
  };
}

/** The parent's children, in name order, each with their family and active enrolments. */
export async function listChildren(ctx: OrgCtx, access: Access): Promise<PortalChild[]> {
  const [children, enrolments] = await Promise.all([
    people.childrenOfGuardian(ctx, access.membershipId),
    enrolment.activeEnrolmentsOf(ctx, people.studentsOfGuardian(ctx, access.membershipId)),
  ]);
  return children.map((child) => toChild(child, enrolments));
}

/** Which of the parent's children a session is for: those whose enrolment covers its date. */
function childrenAt(session: Session, enrolments: Enrolment[]): PortalSession['children'] {
  return enrolments
    .filter(
      (e) =>
        e.classId === session.classId &&
        e.startDate <= session.date &&
        (e.endDate === null || e.endDate >= session.date),
    )
    .map((e) => ({ id: e.studentId, firstName: e.studentFirstName, lastName: e.studentLastName }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

/**
 * The parent's children's timetable: the sessions each child is enrolled for, on the dates their
 * enrolment covers, cancelled ones included. `studentId` picks one child; anyone else is 404.
 */
export async function listSessions(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: { from: string; to: string; studentId?: string },
) {
  const children = people.studentsOfGuardian(ctx, access.membershipId);
  const [page, enrolments] = await Promise.all([
    classes.listSessions(ctx, access, limit, cursor, { ...query, enrolledStudents: children }),
    enrolment.activeEnrolmentsOf(ctx, children),
  ]);
  return {
    data: page.data.map((session): PortalSession => ({
      ...session,
      children: childrenAt(session, enrolments),
    })),
    nextCursor: page.nextCursor,
  };
}

/** An invoice as a parent reads it: its lines don't say which price rule priced them (D-126). */
function toPortalInvoice(invoice: Invoice): PortalInvoice {
  return {
    ...invoice,
    lines: invoice.lines.map(({ priceSource: _source, priceRuleId: _rule, ...line }) => line),
  };
}

/**
 * The parent's families' invoices once issued, newest first, each with what is paid and what is
 * still to pay. A draft isn't theirs to see (D-096). `familyId` outside their families is 404.
 */
export async function listInvoices(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  query: { familyId?: string; status?: InvoiceStatus },
) {
  const { data, nextCursor } = await billing.listInvoices(ctx, access, limit, cursor, query);
  return { data: data.map(toPortalInvoice), nextCursor };
}

/** A parent reports that one of their children is, or was, away. Any other student is 404. */
export function reportAbsence(
  ctx: OrgCtx,
  access: Access,
  input: CreateAbsenceNotice,
): Promise<AbsenceNotice> {
  return attendance.createAbsenceNotice(ctx, access, input, 'parent');
}
