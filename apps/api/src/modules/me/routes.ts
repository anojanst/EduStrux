import { createRoute } from '@hono/zod-openapi';
import { memberships, orgs } from '@edustrux/db';
import { Me } from '@edustrux/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { createRouter, errors, json } from '../../lib/openapi';
import { requireAuth } from '../../middleware/auth';

const meRoute = createRoute({
  method: 'get',
  path: '/api/v1/me',
  tags: ['Me'],
  summary: 'The signed-in user and the orgs they belong to',
  middleware: [requireAuth],
  responses: {
    200: json(Me, 'Current user'),
    ...errors(401),
  },
});

export const meRoutes = createRouter().openapi(meRoute, async (c) => {
  const user = c.var.user;
  const rows = await c.var.db
    .select({
      id: memberships.id,
      role: memberships.role,
      branchIds: memberships.branchIds,
      orgId: orgs.id,
      orgName: orgs.name,
      orgSlug: orgs.slug,
    })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active'),
        isNull(memberships.deletedAt),
        isNull(orgs.deletedAt),
      ),
    )
    .orderBy(asc(orgs.name));

  return c.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      memberships: rows.map((r) => ({
        id: r.id,
        role: r.role,
        branchIds: r.branchIds ?? null,
        org: { id: r.orgId, name: r.orgName, slug: r.orgSlug },
      })),
    },
    200,
  );
});
