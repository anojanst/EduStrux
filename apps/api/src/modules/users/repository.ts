import { memberships, orgs, users, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActiveMembership, AuthUser, OrgRow } from '../../env';

// `users` is the one table without org_id, so this repository isn't org-scoped.

export type ClerkIdentity = { clerkUserId: string; email: string | null; name: string | null };

const columns = {
  id: users.id,
  clerkUserId: users.clerkUserId,
  email: users.email,
  name: users.name,
};

/** Keeps email/name fresh when the token carries them (custom session claims). */
async function refreshed(db: Db, user: AuthUser, identity: ClerkIdentity): Promise<AuthUser> {
  const email = identity.email ?? user.email;
  const name = identity.name ?? user.name;
  if (email === user.email && name === user.name) return user;
  await db.update(users).set({ email, name }).where(eq(users.id, user.id));
  return { ...user, email, name };
}

/** Two first requests can race; the unique index on clerk_user_id makes one a no-op. */
function insertUser(db: Db, identity: ClerkIdentity) {
  return db
    .insert(users)
    .values({ id: newId('user'), ...identity })
    .onConflictDoNothing({ target: users.clerkUserId });
}

function findUser(db: Db, clerkUserId: string) {
  return db.select(columns).from(users).where(eq(users.clerkUserId, clerkUserId)).get();
}

export async function findOrCreateUser(db: Db, identity: ClerkIdentity): Promise<AuthUser> {
  const existing = await findUser(db, identity.clerkUserId);
  if (existing) return refreshed(db, existing, identity);

  await insertUser(db, identity);
  const created = await findUser(db, identity.clerkUserId);
  if (!created) throw new Error('User row missing after insert');
  return created;
}

export type UserInOrg = {
  user: AuthUser;
  /** null when the user has no active membership in the org. */
  membership: ActiveMembership | null;
  /** null without a membership, and when the org is deleted. */
  org: OrgRow | null;
};

/**
 * The user with their active membership in one org and that org, in one statement: the user by
 * Clerk id, the membership through its unique (org, user) index, the org by primary key. The
 * joins are left joins, so a user who isn't a member still comes back, with nulls.
 */
function findUserInOrg(db: Db, clerkUserId: string, orgId: string): Promise<UserInOrg | undefined> {
  return db
    .select({
      user: columns,
      membership: {
        id: memberships.id,
        orgId: memberships.orgId,
        userId: memberships.userId,
        role: memberships.role,
        branchIds: memberships.branchIds,
      },
      org: orgs,
    })
    .from(users)
    .leftJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.orgId, orgId),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
      ),
    )
    .leftJoin(orgs, and(eq(orgs.id, memberships.orgId), isNull(orgs.deletedAt)))
    .where(eq(users.clerkUserId, clerkUserId))
    .get();
}

/**
 * `findOrCreateUser` for a request to an org: the same user row, created and kept fresh the
 * same way, plus the caller's membership and the org from the same D1 call (D-099). Only a
 * user's very first request, or one whose token carries a new email or name, costs more.
 */
export async function findOrCreateUserInOrg(
  db: Db,
  identity: ClerkIdentity,
  orgId: string,
): Promise<UserInOrg> {
  const existing = await findUserInOrg(db, identity.clerkUserId, orgId);
  if (existing) return { ...existing, user: await refreshed(db, existing.user, identity) };

  await insertUser(db, identity);
  const created = await findUserInOrg(db, identity.clerkUserId, orgId);
  if (!created) throw new Error('User row missing after insert');
  return created;
}
