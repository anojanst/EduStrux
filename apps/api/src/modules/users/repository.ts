import { users, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { eq } from 'drizzle-orm';
import type { AuthUser } from '../../env';

// `users` is the one table without org_id, so this repository isn't org-scoped.

export type ClerkIdentity = { clerkUserId: string; email: string | null; name: string | null };

const columns = {
  id: users.id,
  clerkUserId: users.clerkUserId,
  email: users.email,
  name: users.name,
};

export async function findOrCreateUser(db: Db, identity: ClerkIdentity): Promise<AuthUser> {
  const existing = await db
    .select(columns)
    .from(users)
    .where(eq(users.clerkUserId, identity.clerkUserId))
    .get();

  if (existing) {
    // Keep email/name fresh when the token carries them (custom session claims).
    const email = identity.email ?? existing.email;
    const name = identity.name ?? existing.name;
    if (email !== existing.email || name !== existing.name) {
      await db.update(users).set({ email, name }).where(eq(users.id, existing.id));
      return { ...existing, email, name };
    }
    return existing;
  }

  // Two first requests can race; the unique index on clerk_user_id makes one a no-op.
  await db
    .insert(users)
    .values({ id: newId('user'), ...identity })
    .onConflictDoNothing({ target: users.clerkUserId });

  const created = await db
    .select(columns)
    .from(users)
    .where(eq(users.clerkUserId, identity.clerkUserId))
    .get();
  if (!created) throw new Error('User row missing after insert');
  return created;
}
