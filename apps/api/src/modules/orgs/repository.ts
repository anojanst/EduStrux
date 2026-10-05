import { memberships, orgs, type Db } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { writeWithAudit, type OrgCtx } from '../../db/scope';

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

/** Creates the org and makes the creator its owner, in one batch with the audit row. */
export async function insertOrgWithOwner(
  db: Db,
  org: NewOrgRow & { id: string },
  ownerUserId: string,
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
    ],
    { action: 'org.created', entityType: 'org', entityId: org.id, after: org },
  );
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
