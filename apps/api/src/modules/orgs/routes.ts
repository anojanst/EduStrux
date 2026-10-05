import { createRoute, z } from '@hono/zod-openapi';
import { CreateOrg, Org, UpdateOrg } from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { requireAuth } from '../../middleware/auth';
import { byUser, idempotent } from '../../middleware/idempotency';
import { orgAccess } from '../../middleware/permission';
import * as service from './service';

export const OrgParams = z.object({
  orgId: z
    .string()
    .openapi({ param: { name: 'orgId', in: 'path' }, example: 'org_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
});

const IdempotencyHeader = z.object({
  'idempotency-key': z
    .string()
    .max(255)
    .optional()
    .openapi({
      description: 'Retry-safe key. The first successful response is replayed for retries.',
    }),
});

const createOrgRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs',
  tags: ['Orgs'],
  summary: 'Create an organisation',
  description: 'Creates the org on a 14-day trial and makes the caller its owner.',
  middleware: [requireAuth, idempotent(byUser)],
  request: { headers: IdempotencyHeader, body: jsonBody(CreateOrg) },
  responses: {
    201: json(Org, 'The new org'),
    ...errors(400, 401, 409, 422),
  },
});

const getOrgRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}',
  tags: ['Orgs'],
  summary: 'Get the organisation',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams },
  responses: {
    200: json(Org, 'The org'),
    ...errors(401, 403, 404),
  },
});

const updateOrgRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}',
  tags: ['Orgs'],
  summary: 'Update organisation settings',
  description:
    'Partial update. Send the `updatedAt` you last read; a newer one on the server returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(UpdateOrg) },
  responses: {
    200: json(Org, 'The updated org'),
    ...errors(400, 401, 403, 404, 409),
  },
});

export const orgRoutes = createRouter()
  .openapi(createOrgRoute, async (c) => {
    const org = await service.createOrg(c.var.db, c.var.user.id, c.req.valid('json'));
    return c.json(org, 201);
  })
  .openapi(getOrgRoute, async (c) => {
    return c.json(await service.getOrg(orgCtx(c)), 200);
  })
  .openapi(updateOrgRoute, async (c) => {
    return c.json(await service.updateOrg(orgCtx(c), c.req.valid('json')), 200);
  });
