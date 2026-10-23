import type { Db } from '@edustrux/db';
import {
  newId,
  ORG_WIDE_ROLES,
  type CreatedInvitation,
  type CreateInvitation,
  type Invitation,
  type InviteGuardian,
  type Role,
  type StaffMember,
  type StaffRole,
  type Teacher,
  type TeacherList,
  type UpdateStaffMember,
} from '@edustrux/shared';
import type { EmailMessage } from '../../background/messages';
import type { Access, OrgCtx } from '../../db/scope';
import type { AuthUser } from '../../env';
import { conflict, forbidden, notFound, staleData, unprocessable } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as branches from '../branches/service';
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import * as repo from './repository';

const INVITE_DAYS = 7;

/** The roles staff limited to some branches may give: none that reach the whole org (D-131). */
const BRANCH_GRANTABLE: Role[] = ['branch_manager', 'front_desk', 'teacher'];

function toStaffMember({ membership, name, email }: repo.MemberRow): StaffMember {
  const { orgId: _org, deletedAt: _deleted, ...rest } = membership;
  return { ...rest, name, email };
}

function toInvitation(row: repo.InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    branchIds: row.branchIds ?? null,
    guardianId: row.guardianId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * A role's scope as a filter on memberships. Staff limited to some branches reach the branch
 * managers, front desk and teachers whose branches all sit inside their own; with no branch list
 * they reach those roles in every branch. Owners, accountants and parents are the owner's.
 */
function reachOf(access: Access): repo.Reach {
  if (access.scope === 'all') return {};
  return { roles: BRANCH_GRANTABLE, branchIds: access.branchIds ?? undefined };
}

/**
 * Staff limited to some branches can only give the roles they may reach, with branches they
 * have themselves. They can see every branch exists, so it's 403, not 404 (D-033).
 */
function checkGrant(access: Access, role: Role, branchIds: string[] | null) {
  if (access.scope === 'all') return;
  if (!BRANCH_GRANTABLE.includes(role)) throw forbidden('You can’t give this role');
  const own = access.branchIds;
  if (own && (branchIds === null || branchIds.some((id) => !own.includes(id)))) {
    throw forbidden('You can only give branches you have yourself');
  }
}

/** The branch list a role keeps: none for the roles that reach the whole org. */
function branchesFor(role: Role, branchIds: string[] | null | undefined): string[] | null {
  if (ORG_WIDE_ROLES.includes(role as StaffRole)) return null;
  return branchIds ? [...new Set(branchIds)] : null;
}

async function checkBranchesExist(ctx: OrgCtx, branchIds: string[] | null) {
  if (branchIds && (await branches.unknownBranchIds(ctx, branchIds)).length > 0) {
    throw unprocessable('No such branch', { branchIds: ['Unknown branch'] });
  }
}

// ── Members ─────────────────────────────────────────────────────────────────

export async function listStaff(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
) {
  const rows = await repo.listStaff(ctx, limit, decodeCursor(cursor), reachOf(access));
  const { data, nextCursor } = toPage(
    rows.map((row) => ({ ...row, id: row.membership.id })),
    limit,
  );
  return { data: data.map(toStaffMember), nextCursor };
}

/**
 * Who a class or lesson can be given to (TUI-111): every active member of staff, with only what
 * a picker needs. Staff limited to some branches get those who work in one of them.
 */
export async function listTeachers(ctx: OrgCtx, access: Access): Promise<TeacherList> {
  const limited = access.scope === 'branch' ? (access.branchIds ?? undefined) : undefined;
  const rows = await repo.listTeachers(ctx, limited);
  return {
    data: rows.map(({ membership, name, email }) => ({
      id: membership.id,
      name: name ?? email ?? '',
      role: membership.role as Teacher['role'],
      branchIds: membership.branchIds ?? null,
    })),
    nextCursor: null,
  };
}

/**
 * Nobody changes or removes their own membership. Only owners reach owners, so this also keeps
 * the owner making a change: an org always has one (D-131).
 */
function checkNotSelf(access: Access, id: string) {
  if (id === access.membershipId) {
    throw unprocessable('You can’t change or remove your own membership');
  }
}

/**
 * Changes a member's role, branches or status. A parent's membership only changes status: their
 * reach comes from the guardians linked to it, not from a role or branches.
 */
export async function updateStaffMember(
  ctx: OrgCtx,
  access: Access,
  id: string,
  input: UpdateStaffMember,
): Promise<StaffMember> {
  const [found, unknownBranches] = await Promise.all([
    repo.findMember(ctx, id, reachOf(access)),
    input.branchIds ? branches.unknownBranchIds(ctx, input.branchIds) : [],
  ]);
  if (!found) throw notFound('Staff member');
  const before = found.membership;
  checkNotSelf(access, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const changes: repo.MemberChanges = {};
  if (input.status !== undefined) changes.status = input.status;
  if (before.role === 'parent') {
    if (input.role !== undefined || input.branchIds !== undefined) {
      throw unprocessable('A parent’s membership only changes status', {
        ...(input.role !== undefined ? { role: ['Parent'] } : {}),
        ...(input.branchIds !== undefined ? { branchIds: ['Parent'] } : {}),
      });
    }
  } else if (input.role !== undefined || input.branchIds !== undefined) {
    const role = input.role ?? before.role;
    const branchIds = branchesFor(
      role,
      input.branchIds !== undefined ? input.branchIds : before.branchIds,
    );
    checkGrant(access, role, branchIds);
    if (input.branchIds && unknownBranches.length > 0) {
      throw unprocessable('No such branch', { branchIds: ['Unknown branch'] });
    }
    changes.role = role;
    changes.branchIds = branchIds;
  }
  if (Object.keys(changes).length === 0) return toStaffMember(found);

  const updated = await repo.updateMember(ctx, before, changes);
  return toStaffMember({ ...found, membership: updated });
}

/**
 * Removes a member. A teacher of any class stays until their classes have another teacher. A
 * parent's guardians are unlinked, so they no longer reach those families (D-053).
 */
export async function removeStaffMember(ctx: OrgCtx, access: Access, id: string): Promise<void> {
  const [found, classesTaught] = await Promise.all([
    repo.findMember(ctx, id, reachOf(access)),
    classes.countClasses(ctx, { teacherId: id }),
  ]);
  if (!found) throw notFound('Staff member');
  const before = found.membership;
  checkNotSelf(access, id);
  if (classesTaught > 0) {
    throw unprocessable(
      `They teach ${classesTaught} ${classesTaught === 1 ? 'class' : 'classes'}. Give ` +
        'those classes another teacher first, or suspend them instead.',
    );
  }
  const also = before.role === 'parent' ? [people.unlinkMembershipStatement(ctx, id)] : [];
  await repo.softDeleteMember(ctx, before, also);
}

/**
 * Suspends the user's memberships in every org, when Clerk says the user was deleted (TUI-71).
 * Their records stay; an owner can remove them. One audit row in each org, by no one. Returns
 * how many were suspended.
 */
export async function suspendEverywhere(db: Db, userId: string) {
  const rows = await repo.activeMembershipsOfUser(db, userId);
  for (const row of rows) {
    await repo.updateMember({ db, orgId: row.orgId, actorUserId: null }, row, {
      status: 'suspended',
    });
  }
  return rows.length;
}

// ── Invitations ─────────────────────────────────────────────────────────────

/** A random URL-safe token, and the hash that is all we store of it. */
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { token, tokenHash: await hashToken(token) };
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores the invite, then queues its email. Nothing sends invite emails yet (TUI-65), so the
 * token is also in the answer for the inviter to share (D-131). A queue that fails doesn't undo
 * the invite: the inviter still has the token.
 */
async function invite(
  ctx: OrgCtx,
  queue: Queue<EmailMessage>,
  fields: Pick<repo.NewInvitationRow, 'email' | 'role' | 'branchIds' | 'guardianId'>,
): Promise<CreatedInvitation> {
  const { token, tokenHash } = await newToken();
  const stored = await repo.insertInvitation(ctx, {
    id: newId('invitation'),
    orgId: ctx.orgId,
    ...fields,
    tokenHash,
    invitedByUserId: ctx.actorUserId ?? '',
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
    acceptedAt: null,
  });
  const org = await orgs.getOrg(ctx);
  try {
    await queue.send({
      orgId: ctx.orgId,
      to: fields.email,
      template: 'invitation',
      data: { token, role: fields.role, orgName: org.name, expiresAt: stored.expiresAt },
    });
  } catch (err) {
    console.error(`invitation ${stored.id}: email not queued`, err);
  }
  return { invitation: toInvitation(stored), token };
}

/**
 * Invites someone to join as staff. Sending a new invite to the same email withdraws the one
 * still pending.
 */
export async function inviteStaff(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<EmailMessage>,
  input: CreateInvitation,
): Promise<CreatedInvitation> {
  const branchIds = branchesFor(input.role, input.branchIds);
  checkGrant(access, input.role, branchIds);
  const [isMember] = await Promise.all([
    repo.emailIsMember(ctx, input.email),
    checkBranchesExist(ctx, branchIds),
  ]);
  if (isMember) throw conflict('They are already a member', { email: ['Already a member'] });
  return invite(ctx, queue, { email: input.email, role: input.role, branchIds, guardianId: null });
}

/**
 * Invites a guardian to sign in as a parent. Accepting links the guardian to their parent
 * membership, which is what reaches the family (D-053). A new invite for the same guardian
 * withdraws the one still pending.
 */
export async function inviteGuardian(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<EmailMessage>,
  guardianId: string,
  input: InviteGuardian,
): Promise<CreatedInvitation> {
  const guardian = await people.guardianToInvite(ctx, access, guardianId);
  if (guardian.membershipId) {
    throw conflict('This guardian already signs in', { guardianId: ['Already signs in'] });
  }
  const email = input.email ?? guardian.email?.toLowerCase();
  if (!email) {
    throw unprocessable('The guardian has no email. Send one with the invite.', {
      email: ['Required'],
    });
  }
  return invite(ctx, queue, { email, role: 'parent', branchIds: null, guardianId });
}

/**
 * What an invite link shows before sign-in: the org, the role and the address it was sent to.
 * Anyone holding the token may read it, as they may accept it. Unknown or withdrawn is 404.
 */
export async function previewInvitation(db: Db, token: string) {
  const invitation = await repo.findInvitationByHash(db, await hashToken(token));
  if (!invitation) throw notFound('Invitation');
  const org = await orgs.getOrg({ db, orgId: invitation.orgId, actorUserId: null });
  const status = invitation.acceptedAt
    ? 'accepted'
    : invitation.expiresAt <= new Date().toISOString()
      ? 'expired'
      : 'pending';
  return {
    org: { name: org.name, slug: org.slug },
    role: invitation.role,
    email: invitation.email,
    status,
    expiresAt: invitation.expiresAt,
  } as const;
}

/**
 * Accepts an invite as the signed-in user: the token alone says who may (D-131). It gives them
 * the membership the invite names. A parent who already has one in the org keeps it, and the
 * guardian is linked to it. A removed member's membership is brought back.
 */
export async function acceptInvitation(db: Db, user: AuthUser, token: string) {
  const invitation = await repo.findInvitationByHash(db, await hashToken(token));
  if (!invitation) throw notFound('Invitation');
  if (invitation.acceptedAt) {
    throw unprocessable('This invitation has already been used', { token: ['Used'] });
  }
  if (invitation.expiresAt <= new Date().toISOString()) {
    throw unprocessable('This invitation has expired. Ask for a new one.', { token: ['Expired'] });
  }

  const ctx: OrgCtx = { db, orgId: invitation.orgId, actorUserId: user.id };
  const [org, existing, guardian] = await Promise.all([
    orgs.getOrg(ctx),
    repo.findMembershipOfUser(ctx, user.id),
    invitation.guardianId ? people.findGuardian(ctx, invitation.guardianId) : undefined,
  ]);

  let joining: repo.Joining;
  if (existing && existing.deletedAt === null) {
    const keepsParent =
      invitation.role === 'parent' && existing.role === 'parent' && existing.status === 'active';
    if (!keepsParent) throw conflict('You are already a member of this organisation');
    joining = { kind: 'existing', id: existing.id };
  } else if (existing) {
    joining = {
      kind: 'restore',
      id: existing.id,
      changes: { role: invitation.role, branchIds: invitation.branchIds ?? null },
    };
  } else {
    joining = {
      kind: 'insert',
      row: {
        id: newId('membership'),
        orgId: ctx.orgId,
        userId: user.id,
        role: invitation.role,
        branchIds: invitation.branchIds ?? null,
      },
    };
  }

  const also: ReturnType<typeof people.linkGuardianStatement>[] = [];
  if (invitation.guardianId) {
    if (!guardian) {
      throw unprocessable('The guardian this invitation was for has been removed', {
        token: ['Guardian removed'],
      });
    }
    const membershipId = joining.kind === 'insert' ? joining.row.id : joining.id;
    if (guardian.membershipId === membershipId) {
      throw conflict('You already sign in as this guardian');
    }
    if (guardian.membershipId)
      throw conflict('This guardian already signs in with another account');
    also.push(people.linkGuardianStatement(ctx, guardian.id, membershipId));
  }

  const membershipId = await repo.acceptInvitation(ctx, invitation, joining, also);
  const role = joining.kind === 'existing' ? existing!.role : invitation.role;
  const branchIds =
    joining.kind === 'existing' ? (existing!.branchIds ?? null) : (invitation.branchIds ?? null);
  return {
    id: membershipId,
    role,
    branchIds,
    org: { id: org.id, name: org.name, slug: org.slug },
  };
}

/** This module's part of erasing a family (TUI-79), for the erasure's one batch. */
export function eraseStatements(ctx: OrgCtx, guardianIds: string[]) {
  return repo.eraseStatements(ctx, guardianIds);
}
