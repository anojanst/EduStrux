import { createRoute, z } from '@hono/zod-openapi';
import {
  AdminOrg,
  AdminOrgDetail,
  AdminOrgQuery,
  Impersonate,
  ImpersonationLink,
  UpdateAdminOrg,
  page,
} from '@edustrux/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../../env';
import { notFound } from '../../lib/errors';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { signedInAs } from '../../middleware/auth';
import { findOrCreateUser } from '../users/repository';
import { logAdmin } from './log';
import * as service from './service';

// The super-admin console (TUI-75), outside the org routes.

/**
 * Only the Clerk users named in SUPER_ADMIN_CLERK_USER_IDS, signed in as themselves (not while
 * impersonating someone). Anyone else gets the 404 of a route that isn't there. Every request
 * that gets through is logged before it runs.
 */
const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await signedInAs(c);
  const admins = (c.env.SUPER_ADMIN_CLERK_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!admins.includes(identity.clerkUserId) || c.var.impersonatedBy) {
    throw notFound('Route');
  }
  const user = await findOrCreateUser(c.var.db, identity);
  c.set('user', user);
  await logAdmin(c, 'admin.request', user);
  await next();
});

const OrgIdParams = z.object({
  orgId: z.string().openapi({ param: { name: 'orgId', in: 'path' } }),
});

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/admin/orgs',
  tags: ['Super-admin'],
  summary: 'Every organisation',
  description:
    'Newest first, with their owners. `q` finds orgs by the start of their name or slug. ' +
    'Super-admins only: anyone else gets 404. Every request is logged.',
  middleware: [requireSuperAdmin],
  request: { query: AdminOrgQuery },
  responses: {
    200: json(page(AdminOrg).openapi('AdminOrgPage'), 'A page of orgs'),
    ...errors(400, 401, 404),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/admin/orgs/{orgId}',
  tags: ['Super-admin'],
  summary: 'One organisation, with its plan and size',
  middleware: [requireSuperAdmin],
  request: { params: OrgIdParams },
  responses: { 200: json(AdminOrgDetail, 'The org'), ...errors(401, 404) },
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/admin/orgs/{orgId}',
  tags: ['Super-admin'],
  summary: 'Change an organisation’s plan, status or trial',
  description:
    'For support: lengthen a trial, put an org on the custom plan, suspend or restore it. A ' +
    'later Stripe event sets plan and status again. Recorded in the org’s audit log as ' +
    '`org.admin_updated`.',
  middleware: [requireSuperAdmin],
  request: { params: OrgIdParams, body: jsonBody(UpdateAdminOrg) },
  responses: { 200: json(AdminOrgDetail, 'The org as changed'), ...errors(400, 401, 404, 409) },
});

const impersonateRoute = createRoute({
  method: 'post',
  path: '/api/v1/admin/orgs/{orgId}/impersonate',
  tags: ['Super-admin'],
  summary: 'Sign in as one of an organisation’s members',
  description:
    'A one-time Clerk link (10 minutes) that signs the admin in as the member, the org’s first ' +
    'owner by default, for up to an hour. Recorded with the reason in the org’s audit log as ' +
    '`org.impersonated`, and every request made in that session is logged. Needs ' +
    '`CLERK_SECRET_KEY` (503 without).',
  middleware: [requireSuperAdmin],
  request: { params: OrgIdParams, body: jsonBody(Impersonate) },
  responses: {
    201: json(ImpersonationLink, 'The sign-in link'),
    ...errors(400, 401, 404, 422, 503),
  },
});

export const adminRoutes = createRouter()
  .openapi(listRoute, async (c) =>
    c.json(await service.listOrgs(c.var.db, c.req.valid('query')), 200),
  )
  .openapi(getRoute, async (c) =>
    c.json(await service.getOrg(c.var.db, c.req.valid('param').orgId), 200),
  )
  .openapi(updateRoute, async (c) =>
    c.json(
      await service.updateOrg(
        c.var.db,
        c.var.user,
        c.req.valid('param').orgId,
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(impersonateRoute, async (c) => {
    const input = c.req.valid('json');
    const link = await service.impersonate(
      c.var.db,
      c.env,
      c.var.user,
      c.req.valid('param').orgId,
      input,
    );
    await logAdmin(c, 'admin.impersonate', c.var.user, {
      userId: link.userId,
      reason: input.reason,
    });
    return c.json(link, 201);
  });
