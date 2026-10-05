import { memberships, orgs } from '@edustrux/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { notFound } from '../lib/errors';

/**
 * Loads the caller's active membership in the org named by the `orgId` path param.
 * Non-members get 404, the same as a missing org, so we never confirm an org id exists.
 */
export const requireOrgMember = createMiddleware<AppEnv>(async (c, next) => {
  const orgId = c.req.param('orgId');
  if (!orgId) throw notFound('Organisation');

  const membership = await c.var.db
    .select({
      id: memberships.id,
      orgId: memberships.orgId,
      userId: memberships.userId,
      role: memberships.role,
      branchIds: memberships.branchIds,
    })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, c.var.user.id),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
        isNull(orgs.deletedAt),
      ),
    )
    .get();

  if (!membership) throw notFound('Organisation');
  c.set('membership', membership);
  await next();
});
