import {
  localNow,
  newId,
  type ApproveEnrolmentRequest,
  type CreateEnquiry,
  type CreateEnrolmentRequest,
  type Enquiry,
  type EnrolmentRequest,
  type PublicForm,
} from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import type { Bindings, OrgRow } from '../../env';
import { ApiError, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import * as classes from '../classes/service';
import * as curriculum from '../curriculum/service';
import * as enrolment from '../enrolment/service';
import * as people from '../people/service';
import * as repo from './repository';

// The public enquiry and enrolment forms, and staff dealing with what they bring in (TUI-47).

/** At most this many forms from one address to one org an hour, enquiries and requests together. */
export const FORMS_PER_HOUR = 10;

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** A public form's context: the org, with nobody signed in. */
export function publicCtx(db: OrgCtx['db'], org: OrgRow): OrgCtx {
  return { db, orgId: org.id, actorUserId: null, org };
}

/** What a public form shows: the org's name, branches, running classes and what they teach. */
export async function publicForm(ctx: OrgCtx, org: OrgRow): Promise<PublicForm> {
  const today = localNow(org.timezone).date;
  const [branchList, open, grades, catalogue] = await Promise.all([
    branches.listBranches(ctx, 200),
    classes.openClasses(ctx, today),
    curriculum.listGradeLevels(ctx),
    curriculum.catalogue(ctx),
  ]);
  return {
    orgName: org.name,
    branches: branchList.data.map((b) => ({ id: b.id, name: b.name })),
    classes: open,
    gradeLevels: grades.data.map((g) => ({ id: g.id, name: g.name })),
    ...catalogue,
  };
}

/**
 * The guards every public form passes: a filled-in hidden field is a bot, answered as if all
 * went well and nothing stored; a Turnstile token when the org has Turnstile on; and at most
 * FORMS_PER_HOUR forms from one address an hour (429). Returns the address's hash to store, or
 * null for a bot.
 */
async function guard(
  ctx: OrgCtx,
  env: Bindings,
  ip: string | null,
  form: { website?: string; turnstileToken?: string },
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  if (form.website) return null;
  if (env.TURNSTILE_SECRET_KEY) {
    if (!form.turnstileToken) throw validationFailed({ turnstileToken: ['Required'] });
    const body = new FormData();
    body.set('secret', env.TURNSTILE_SECRET_KEY);
    body.set('response', form.turnstileToken);
    if (ip) body.set('remoteip', ip);
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const verdict = (await res.json().catch(() => ({}))) as { success?: boolean };
    if (!verdict.success) throw validationFailed({ turnstileToken: ['Failed'] });
  }
  const ipHash = await sha256(`${ctx.orgId}:${ip ?? 'unknown'}`);
  const since = new Date(Date.now() - 3_600_000).toISOString();
  if ((await repo.sentSince(ctx, ipHash, since)) >= FORMS_PER_HOUR) {
    throw new ApiError(429, 'rate_limited', 'Too many forms sent. Try again in an hour.');
  }
  return ipHash;
}

/** A branch named on a public form must be the org's (400: the form shows the choices). */
async function checkBranch(ctx: OrgCtx, branchId: string | undefined) {
  if (!branchId) return;
  try {
    await branches.getBranch(ctx, branchId);
  } catch {
    throw validationFailed({ branchId: ['Unknown branch'] });
  }
}

export async function receiveEnquiry(
  ctx: OrgCtx,
  env: Bindings,
  ip: string | null,
  input: CreateEnquiry,
) {
  const ipHash = await guard(ctx, env, ip, input);
  if (ipHash === null) return { received: true as const, id: null };
  await checkBranch(ctx, input.branchId);
  const id = newId('enquiry');
  await repo.insertEnquiry(ctx, {
    id,
    orgId: ctx.orgId,
    branchId: input.branchId ?? null,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    studentName: input.studentName ?? null,
    message: input.message,
    status: 'new',
    ipHash,
  });
  return { received: true as const, id };
}

export async function receiveRequest(
  ctx: OrgCtx,
  env: Bindings,
  ip: string | null,
  input: CreateEnrolmentRequest,
) {
  const ipHash = await guard(ctx, env, ip, input);
  if (ipHash === null) return { received: true as const, id: null };
  await checkBranch(ctx, input.branchId);
  // Every class asked for must be one the org has (400: the form shows the choices).
  const asked = [...new Set(input.students.flatMap((s) => s.classIds))];
  const known = await classes.classLabels(ctx, asked);
  const fields: Record<string, string[]> = {};
  input.students.forEach((student, i) =>
    student.classIds.forEach((classId, j) => {
      if (!known.has(classId)) fields[`students.${i}.classIds.${j}`] = ['Unknown class'];
    }),
  );
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const id = newId('enrolmentRequest');
  await repo.insertRequest(ctx, {
    id,
    orgId: ctx.orgId,
    branchId: input.branchId ?? null,
    status: 'pending',
    guardian: {
      firstName: input.guardian.firstName,
      lastName: input.guardian.lastName,
      email: input.guardian.email,
      phone: input.guardian.phone ?? null,
    },
    students: input.students.map((s) => ({
      firstName: s.firstName,
      lastName: s.lastName,
      dateOfBirth: s.dateOfBirth ?? null,
      classIds: s.classIds,
    })),
    notes: input.notes ?? null,
    ipHash,
  });
  return { received: true as const, id };
}

// ── Staff ───────────────────────────────────────────────────────────────────

function reachOf(access: Access): repo.Reach {
  return access.scope === 'branch' && access.branchIds ? { branchIds: access.branchIds } : {};
}

function toEnquiry(row: repo.EnquiryRow): Enquiry {
  const { orgId: _o, deletedAt: _d, ipHash: _i, ...enquiry } = row;
  return enquiry;
}

export async function listEnquiries(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  status?: string,
) {
  const rows = await repo.listEnquiries(ctx, limit, decodeCursor(cursor), status, reachOf(access));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toEnquiry), nextCursor };
}

export async function updateEnquiry(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: { updatedAt: string; status: repo.EnquiryRow['status'] },
) {
  const before = await repo.findEnquiry(ctx, id, reachOf(access));
  if (!before) throw notFound('Enquiry');
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (before.status === input.status) return toEnquiry(before);
  const updated = await repo.updateEnquiry(ctx, before, input.status);
  if (!updated) throw notFound('Enquiry');
  return toEnquiry(updated);
}

function toRequest(row: repo.RequestRow): EnrolmentRequest {
  const { orgId: _o, deletedAt: _d, ipHash: _i, decidedByUserId: _u, ...request } = row;
  return {
    ...request,
    guardian: row.guardian as EnrolmentRequest['guardian'],
    students: row.students as EnrolmentRequest['students'],
    result: (row.result as EnrolmentRequest['result']) ?? null,
  };
}

export async function listRequests(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  status?: string,
) {
  const rows = await repo.listRequests(ctx, limit, decodeCursor(cursor), status, reachOf(access));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toRequest), nextCursor };
}

async function pendingRequest(ctx: OrgCtx, access: Access, id: string) {
  const request = await repo.findRequest(ctx, id, reachOf(access));
  if (!request) throw notFound('Enrolment request');
  if (request.status !== 'pending') {
    throw unprocessable(`This request was already ${request.status}.`, {
      status: [request.status === 'approved' ? 'Approved' : 'Rejected'],
    });
  }
  return request;
}

/**
 * Approves a request: the family (a new one, or one on record), its guardian, the children and
 * their enrolments are added with the usual rules and the caller's reach. A class that refuses an
 * enrolment (full, already enrolled, outside its dates) is listed in `result.skipped`; the rest
 * still goes ahead. The steps are separate writes, each with its own audit row.
 */
export async function approveRequest(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: ApproveEnrolmentRequest,
): Promise<EnrolmentRequest> {
  const request = await pendingRequest(ctx, access, id);
  const guardian = toRequest(request).guardian;
  const students = toRequest(request).students;

  let familyId: string;
  let guardianId: string | null = null;
  if (input.familyId) {
    const family = await people.getFamily(ctx, access, input.familyId);
    familyId = family.id;
    guardianId = family.guardians.find((g) => g.email === guardian.email)?.id ?? null;
  } else {
    let branchId = input.branchId ?? request.branchId;
    if (!branchId) {
      const labels = await classes.classLabels(ctx, students[0]?.classIds.slice(0, 1) ?? []);
      branchId = [...labels.values()][0]?.branchId ?? null;
    }
    if (!branchId) {
      throw unprocessable('Say which branch the family belongs to.', { branchId: ['Required'] });
    }
    const family = await people.createFamily(ctx, access, { name: guardian.lastName, branchId });
    familyId = family.id;
  }
  if (!guardianId) {
    const created = await people.createGuardian(ctx, access, familyId, {
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      email: guardian.email,
      phone: guardian.phone ?? undefined,
      preferredChannel: 'email',
      emergencyContact: true,
    });
    guardianId = created.id;
  }

  const studentIds: string[] = [];
  const enrolmentIds: string[] = [];
  const skipped: { studentIndex: number; classId: string; reason: string }[] = [];
  for (const [index, child] of students.entries()) {
    const student = await people.createStudent(ctx, access, {
      familyId,
      firstName: child.firstName,
      lastName: child.lastName,
      dateOfBirth: child.dateOfBirth ?? undefined,
    });
    studentIds.push(student.id);
    for (const classId of child.classIds) {
      try {
        const made = await enrolment.createEnrolment(ctx, access, {
          studentId: student.id,
          classId,
        });
        enrolmentIds.push(made.id);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        skipped.push({ studentIndex: index, classId, reason: err.message });
      }
    }
  }

  const decided = await repo.decideRequest(ctx, request, {
    status: 'approved',
    reason: null,
    result: { familyId, guardianId, studentIds, enrolmentIds, skipped },
  });
  if (!decided) throw unprocessable('This request was decided by someone else just now.');
  return toRequest(decided);
}

export async function rejectRequest(
  ctx: OrgCtx,
  access: Access,
  id: string,
  reason: string | undefined,
): Promise<EnrolmentRequest> {
  const request = await pendingRequest(ctx, access, id);
  const decided = await repo.decideRequest(ctx, request, {
    status: 'rejected',
    reason: reason ?? null,
    result: null,
  });
  if (!decided) throw unprocessable('This request was decided by someone else just now.');
  return toRequest(decided);
}
