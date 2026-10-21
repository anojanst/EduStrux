import type { Db } from '@edustrux/db';
import type { AdminOrg, AdminOrgDetail, Impersonate, UpdateAdminOrg } from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import type { AuthUser, Bindings } from '../../env';
import { createActorToken } from '../../lib/clerk';
import { notFound, staleData, unprocessable } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import { toOrg } from '../orgs/service';
import * as subscriptions from '../subscriptions/service';
import * as repo from './repository';

// The super-admin console (TUI-75). Who is a super-admin is the routes' check; every request to
// them is logged there, and what changes an org is also in the org's own audit log.

type Owner = Awaited<ReturnType<typeof repo.ownersOf>>[number];

function toAdminOrg(row: repo.OrgRow, owners: Owner[]): AdminOrg {
  return {
    ...toOrg(row),
    owners: owners
      .filter((o) => o.orgId === row.id)
      .map((o) => ({ userId: o.userId, name: o.name, email: o.email })),
  };
}

export async function listOrgs(
  db: Db,
  query: { limit: number; cursor?: string; q?: string; status?: repo.OrgRow['status'] },
) {
  const rows = await repo.listOrgs(db, query.limit, decodeCursor(query.cursor), query);
  const { data, nextCursor } = toPage(rows, query.limit);
  const owners = data.length
    ? await repo.ownersOf(
        db,
        data.map((o) => o.id),
      )
    : [];
  return { data: data.map((row) => toAdminOrg(row, owners)), nextCursor };
}

/** The org, its owners, its plan and use of it, and how much it holds. */
export async function getOrg(db: Db, id: string): Promise<AdminOrgDetail> {
  const row = await repo.findOrg(db, id);
  if (!row) throw notFound('Organisation');
  const ctx: OrgCtx = { db, orgId: id, actorUserId: null, org: row };
  const [owners, billing, size] = await Promise.all([
    repo.ownersOf(db, [id]),
    subscriptions.overview(ctx),
    repo.sizeOf(db, id),
  ]);
  return { ...toAdminOrg(row, owners), billing, ...size };
}

/** Changes an org's plan, status or trial end, as support. */
export async function updateOrg(db: Db, admin: AuthUser, id: string, input: UpdateAdminOrg) {
  const before = await repo.findOrg(db, id);
  if (!before) throw notFound('Organisation');
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _u, ...changes } = input;
  if (Object.keys(changes).length > 0) {
    await repo.updateOrg({ db, orgId: id, actorUserId: admin.id }, before, changes);
  }
  return getOrg(db, id);
}

/**
 * A one-time link that signs the admin in as one of the org's members (its first owner unless
 * one is named), through Clerk's actor tokens. Recorded in the org's own audit log with the
 * reason; the requests made in that session are logged as they come.
 */
export async function impersonate(
  db: Db,
  env: Bindings,
  admin: AuthUser,
  id: string,
  input: Impersonate,
) {
  const row = await repo.findOrg(db, id);
  if (!row || row.deletedAt) throw notFound('Organisation');
  const target = input.userId
    ? await repo.activeMember(db, id, input.userId)
    : (await repo.ownersOf(db, [id]))[0];
  if (!target) {
    throw input.userId
      ? notFound('Member')
      : unprocessable('The organisation has no active owner to sign in as.');
  }
  const link = await createActorToken(env, {
    userClerkId: target.clerkUserId,
    adminClerkId: admin.clerkUserId,
  });
  await repo.recordImpersonation(
    { db, orgId: id, actorUserId: admin.id },
    { userId: target.userId, reason: input.reason },
  );
  return { url: link.url, userId: target.userId, expiresAt: link.expiresAt };
}
