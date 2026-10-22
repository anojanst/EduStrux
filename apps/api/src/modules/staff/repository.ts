import { invitations, memberships, now, users, type Db } from '@edustrux/db';
import type { Role } from '@edustrux/shared';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { changedFields, inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

// Memberships, invitations and the users they join are one area: people and access (handoff
// §7). `users` has no org_id, so it is only ever read through a membership of the org.

export type MembershipRow = typeof memberships.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;
export type MemberChanges = Partial<Pick<MembershipRow, 'role' | 'branchIds' | 'status'>>;

/**
 * The memberships a caller may see or change: every one when empty. Staff limited to some
 * branches reach only `roles`, and only members whose branch list sits inside `branchIds`.
 */
export type Reach = { roles?: Role[]; branchIds?: string[] };

/** A membership with the name and email of the user who holds it. */
const memberColumns = {
  membership: memberships,
  name: users.name,
  email: users.email,
};
export type MemberRow = { membership: MembershipRow; name: string | null; email: string | null };

/** Every branch on the member's list is one of `branchIds`; no list (every branch) is not. */
const branchesWithin = (branchIds: string[]) =>
  sql`(${memberships.branchIds} is not null and not exists (select 1 from json_each(${memberships.branchIds}) where value not in (select value from json_each(${JSON.stringify(branchIds)}))))`;

const within = (reach: Reach) => [
  reach.roles ? inArray(memberships.role, reach.roles) : undefined,
  reach.branchIds ? branchesWithin(reach.branchIds) : undefined,
];

// ── Members ─────────────────────────────────────────────────────────────────

/** The org's staff, oldest first: everyone but parents. Fetches `limit + 1` rows. */
export function listStaff(ctx: OrgCtx, limit: number, afterId: string | undefined, reach: Reach) {
  return ctx.db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      inOrg(
        ctx,
        memberships,
        ne(memberships.role, 'parent'),
        ...within(reach),
        afterId ? gt(memberships.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(memberships.id))
    .limit(limit + 1);
}

/** A membership within reach, of any role. */
export function findMember(ctx: OrgCtx, id: string, reach: Reach): Promise<MemberRow | undefined> {
  return ctx.db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inOrg(ctx, memberships, eq(memberships.id, id), ...within(reach)))
    .get();
}

/**
 * Whether someone signed in with this email is already a member, active or suspended. Read
 * from the org's memberships, each looking its user up, so it never reads every user.
 */
export async function emailIsMember(ctx: OrgCtx, email: string) {
  const row = await ctx.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      inOrg(
        ctx,
        memberships,
        sql`exists (select 1 from ${users} where ${users.id} = ${memberships.userId} and lower(${users.email}) = ${email})`,
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * The user's membership in the org, removed ones too: the unique (org, user) index still holds
 * a removed member's row, so accepting a new invite brings it back.
 */
export function findMembershipOfUser(ctx: OrgCtx, userId: string) {
  return ctx.db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)))
    .get();
}

/** The user's active memberships in every org, for Clerk's user.deleted webhook. */
export function activeMembershipsOfUser(db: Db, userId: string) {
  return db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
      ),
    );
}

/** Returns the membership as updated, from the same batch. */
export async function updateMember(
  ctx: OrgCtx,
  before: MembershipRow,
  changes: MemberChanges,
): Promise<MembershipRow> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(memberships)
        .set(changes)
        .where(inOrg(ctx, memberships, eq(memberships.id, before.id)))
        .returning(),
    ],
    {
      action: 'membership.updated',
      entityType: 'membership',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  const row = (updated as MembershipRow[])[0];
  if (!row) throw new Error('Membership missing after update');
  return row;
}

/** `also` are other modules' statements for the same batch, such as unlinking guardians. */
export async function softDeleteMember(
  ctx: OrgCtx,
  before: MembershipRow,
  also: BatchItem<'sqlite'>[],
) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(memberships)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, memberships, eq(memberships.id, before.id))),
      ...also,
    ],
    { action: 'membership.deleted', entityType: 'membership', entityId: before.id, before },
  );
}

// ── Invitations ─────────────────────────────────────────────────────────────

/**
 * Adds the invite and withdraws the ones it replaces, still pending: the same email's staff
 * invites, or the same guardian's. Returns the invite as stored.
 */
export async function insertInvitation(
  ctx: OrgCtx,
  row: NewInvitationRow & { id: string },
): Promise<InvitationRow> {
  const replaced = row.guardianId
    ? eq(invitations.guardianId, row.guardianId)
    : and(eq(invitations.email, row.email), isNull(invitations.guardianId));
  const { tokenHash: _secret, ...shown } = row;
  const [, , inserted] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invitations)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, invitations, replaced, isNull(invitations.acceptedAt))),
      ctx.db.insert(invitations).values(row).returning(),
    ],
    { action: 'invitation.created', entityType: 'invitation', entityId: row.id, after: shown },
  );
  const stored = (inserted as InvitationRow[])[0];
  if (!stored) throw new Error('Invitation missing after insert');
  return stored;
}

/**
 * An invite by its token's hash, in whichever org it is. Not org-scoped: the token is what says
 * which org, and the hash's unique index finds it.
 */
export function findInvitationByHash(db: Db, tokenHash: string) {
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.deletedAt)))
    .get();
}

/** How accepting an invite gives the user their membership. */
export type Joining =
  | { kind: 'insert'; row: typeof memberships.$inferInsert & { id: string } }
  | { kind: 'restore'; id: string; changes: Pick<MembershipRow, 'role' | 'branchIds'> }
  | { kind: 'existing'; id: string };

/**
 * Accepts the invite: the membership (new, a removed one brought back, or the parent membership
 * the user already has), the invite marked used and `also` (linking a guardian) in one batch.
 */
export async function acceptInvitation(
  ctx: OrgCtx,
  invitation: InvitationRow,
  joining: Joining,
  also: BatchItem<'sqlite'>[],
) {
  const membershipId = joining.kind === 'insert' ? joining.row.id : joining.id;
  const join: BatchItem<'sqlite'>[] =
    joining.kind === 'insert'
      ? [ctx.db.insert(memberships).values(joining.row)]
      : joining.kind === 'restore'
        ? [
            ctx.db
              .update(memberships)
              .set({ ...joining.changes, status: 'active', deletedAt: null })
              .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.id, joining.id))),
          ]
        : [];
  await writeWithAudit(
    ctx,
    [
      ...join,
      ctx.db
        .update(invitations)
        .set({ acceptedAt: now() })
        .where(inOrg(ctx, invitations, eq(invitations.id, invitation.id))),
      ...also,
    ],
    {
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      after: {
        membershipId,
        joined: joining.kind,
        role: invitation.role,
        branchIds: invitation.branchIds,
        guardianId: invitation.guardianId,
      },
    },
  );
  return membershipId;
}

/** Deletes the invitations sent to these guardians, accepted or not (TUI-79). */
export function eraseStatements(ctx: OrgCtx, guardianIds: string[]): BatchItem<'sqlite'>[] {
  if (guardianIds.length === 0) return [];
  return [
    ctx.db
      .delete(invitations)
      .where(and(eq(invitations.orgId, ctx.orgId), inIds(invitations.guardianId, guardianIds))),
  ];
}
