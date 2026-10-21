import {
  adminAccessLog,
  families,
  memberships,
  orgs,
  students,
  users,
  type Db,
} from '@edustrux/db';
import { and, asc, count, desc, eq, isNull, like, lt, or, sql } from 'drizzle-orm';
import { changedFields, writeWithAudit, type OrgCtx } from '../../db/scope';

// The super-admin console reads across every org (TUI-75): a documented exception to "a
// repository reads only its own module's tables, within one org", as the export is.

export type OrgRow = typeof orgs.$inferSelect;
export type AdminOrgChanges = Partial<Pick<OrgRow, 'plan' | 'status' | 'trialEndsAt'>>;

/** Orgs newest first, by the start of their name or slug, and status. Deleted ones too. */
export function listOrgs(
  db: Db,
  limit: number,
  beforeId: string | undefined,
  filter: { q?: string; status?: OrgRow['status'] },
) {
  const prefix = filter.q ? `${filter.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%` : null;
  return db
    .select()
    .from(orgs)
    .where(
      and(
        beforeId ? lt(orgs.id, beforeId) : undefined,
        filter.status ? eq(orgs.status, filter.status) : undefined,
        prefix
          ? or(sql`lower(${orgs.name}) like ${prefix} escape '\\'`, like(orgs.slug, prefix))
          : undefined,
      ),
    )
    .orderBy(desc(orgs.id))
    .limit(limit + 1);
}

export function findOrg(db: Db, id: string) {
  return db.select().from(orgs).where(eq(orgs.id, id)).get();
}

/** The active owners of these orgs, with their names and emails, oldest membership first. */
export function ownersOf(db: Db, orgIds: string[]) {
  return db
    .select({
      orgId: memberships.orgId,
      userId: users.id,
      clerkUserId: users.clerkUserId,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        sql`${memberships.orgId} in (select value from json_each(${JSON.stringify(orgIds)}))`,
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
      ),
    )
    .orderBy(asc(memberships.id));
}

/** An active member of the org, with their Clerk id. */
export function activeMember(db: Db, orgId: string, userId: string) {
  return db
    .select({ userId: users.id, clerkUserId: users.clerkUserId, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
      ),
    )
    .get();
}

/** How much the org holds: active members, families and students. */
export async function sizeOf(db: Db, orgId: string) {
  const [m, f, s] = await Promise.all([
    db
      .select({ n: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, orgId),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
        ),
      )
      .get(),
    db
      .select({ n: count() })
      .from(families)
      .where(and(eq(families.orgId, orgId), isNull(families.deletedAt)))
      .get(),
    db
      .select({ n: count() })
      .from(students)
      .where(and(eq(students.orgId, orgId), isNull(students.deletedAt)))
      .get(),
  ]);
  return { members: m?.n ?? 0, families: f?.n ?? 0, students: s?.n ?? 0 };
}

/** The admin's change to an org, with an `org.admin_updated` audit row in the org's log. */
export async function updateOrg(ctx: OrgCtx, before: OrgRow, changes: AdminOrgChanges) {
  const [, updated] = await writeWithAudit(
    ctx,
    [ctx.db.update(orgs).set(changes).where(eq(orgs.id, before.id)).returning()],
    {
      action: 'org.admin_updated',
      entityType: 'org',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as OrgRow[])[0];
}

/** An `org.impersonated` row in the org's own audit log, so its owner can see support came in. */
export async function recordImpersonation(ctx: OrgCtx, detail: { userId: string; reason: string }) {
  await writeWithAudit(ctx, [], {
    action: 'org.impersonated',
    entityType: 'org',
    entityId: ctx.orgId,
    after: detail,
  });
}

/** One line of the super-admin access log. */
export function logAccess(db: Db, row: typeof adminAccessLog.$inferInsert) {
  return db.insert(adminAccessLog).values(row);
}
