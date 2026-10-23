import { memberships, orgs, users, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, count, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { changedFields, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';
import type { OrgRow } from '../../env';

export type { OrgRow };
export type NewOrgRow = typeof orgs.$inferInsert;
export type OrgChanges = Partial<Omit<NewOrgRow, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>;

export function findOrg(ctx: OrgCtx) {
  return ctx.db
    .select()
    .from(orgs)
    .where(and(eq(orgs.id, ctx.orgId), isNull(orgs.deletedAt)))
    .get();
}

/** Slugs are unique across all orgs (they appear in public form URLs). */
export async function slugTaken(db: Db, slug: string, exceptOrgId?: string) {
  const row = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).get();
  return row !== undefined && row.id !== exceptOrgId;
}

/**
 * Creates the org, makes the creator its owner and adds its default branch, in one batch with
 * the audit row. The branch is recorded in that same `org.created` row.
 */
export async function insertOrgWithOwner(
  db: Db,
  org: NewOrgRow & { id: string },
  ownerUserId: string,
  defaultBranch: { row: unknown; statement: BatchItem<'sqlite'> },
) {
  const ctx: OrgCtx = { db, orgId: org.id, actorUserId: ownerUserId };
  await writeWithAudit(
    ctx,
    [
      db.insert(orgs).values(org),
      db.insert(memberships).values({
        id: newId('membership'),
        orgId: org.id,
        userId: ownerUserId,
        role: 'owner',
        branchIds: null,
      }),
      defaultBranch.statement,
    ],
    {
      action: 'org.created',
      entityType: 'org',
      entityId: org.id,
      after: { ...org, defaultBranch: defaultBranch.row },
    },
  );
}

/** A membership in the org, whatever its role or status. */
export function findMembership(ctx: OrgCtx, id: string) {
  return ctx.db
    .select({
      id: memberships.id,
      role: memberships.role,
      status: memberships.status,
      // Their name, or their email when none is set: what a class shows of its teacher.
      name: sql<
        string | null
      >`(select ${sql`coalesce(${users.name}, ${users.email})`} from ${users} where ${eq(users.id, memberships.userId)})`,
    })
    .from(memberships)
    .where(inOrg(ctx, memberships, eq(memberships.id, id)))
    .get();
}

/** Active memberships whose branch list includes this branch (null branch lists mean all). */
export async function countMembersLimitedToBranch(ctx: OrgCtx, branchId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(memberships)
    .where(
      inOrg(
        ctx,
        memberships,
        sql`exists (select 1 from json_each(${memberships.branchIds}) where value = ${branchId})`,
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** Returns the org as updated, from the same batch, so the caller doesn't read it back. */
export async function updateOrg(ctx: OrgCtx, before: OrgRow, changes: OrgChanges): Promise<OrgRow> {
  const update = ctx.db.update(orgs).set(changes).where(eq(orgs.id, ctx.orgId)).returning();
  const [, updated] = await writeWithAudit(ctx, [update], {
    action: 'org.updated',
    entityType: 'org',
    entityId: ctx.orgId,
    ...changedFields(before, changes),
  });
  const row = (updated as OrgRow[])[0];
  if (!row) throw new Error('Org missing after update');
  return row;
}

/** An org by its slug, for the public forms. */
export function findBySlug(db: Db, slug: string) {
  return db
    .select()
    .from(orgs)
    .where(and(eq(orgs.slug, slug), isNull(orgs.deletedAt)))
    .get();
}

/**
 * Every org the crons act for: not deleted, and not suspended or cancelled (nothing is sent on
 * their behalf). Only what the crons need to work out each org's local time.
 */
export function orgsForCron(db: Db) {
  return db
    .select({
      id: orgs.id,
      timezone: orgs.timezone,
      status: orgs.status,
      trialEndsAt: orgs.trialEndsAt,
    })
    .from(orgs)
    .where(and(isNull(orgs.deletedAt), notInArray(orgs.status, ['suspended', 'cancelled'])));
}

/** The statement that sets the org's plan and status, for the subscription's own batch. */
export function setPlanStatement(
  db: Db,
  orgId: string,
  changes: Pick<OrgChanges, 'plan' | 'status'>,
) {
  return db.update(orgs).set(changes).where(eq(orgs.id, orgId));
}

/** The org's row by id, where there is no request (webhooks). Deleted orgs too. */
export function findOrgById(db: Db, orgId: string) {
  return db.select().from(orgs).where(eq(orgs.id, orgId)).get();
}
