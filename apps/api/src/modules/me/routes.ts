import { createRoute } from '@hono/zod-openapi';
import { Me } from '@edustrux/shared';
import { createRouter, errors, json } from '../../lib/openapi';
import { requireAuth } from '../../middleware/auth';
import { membershipsOfUser } from '../users/repository';

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
  const rows = await membershipsOfUser(c.var.db, user.id);

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
