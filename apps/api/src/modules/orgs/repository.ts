import { memberships, orgs, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type OrgRow = typeof orgs.$inferSelect;
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

export async function updateOrg(ctx: OrgCtx, before: OrgRow, changes: OrgChanges) {
  await writeWithAudit(ctx, [ctx.db.update(orgs).set(changes).where(eq(orgs.id, ctx.orgId))], {
    action: 'org.updated',
    entityType: 'org',
    entityId: ctx.orgId,
    before,
    after: changes,
  });
}
