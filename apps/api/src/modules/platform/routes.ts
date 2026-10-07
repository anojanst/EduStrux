import { createRoute, z } from '@hono/zod-openapi';
import { AuditEntry, Job, PageQuery, page } from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json } from '../../lib/openapi';
import { decodeCursor, toPage } from '../../lib/pagination';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as repo from './repository';
import * as service from './service';

const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  tags: ['Platform'],
  summary: 'Liveness check',
  security: [],
  responses: {
    200: json(z.object({ ok: z.literal(true), environment: z.string() }), 'The API is up'),
  },
});

const getJobRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/jobs/{jobId}',
  tags: ['Platform'],
  summary: 'Poll a background job',
  description:
    'Long actions return `202 { jobId }`. Poll this until status is succeeded or failed. ' +
    'Only the person who started the job and the org owner can see it; anyone else gets 404.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams.extend({ jobId: z.string() }) },
  responses: {
    200: json(Job, 'The job'),
    ...errors(401, 403, 404),
  },
});

const auditLogRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/audit-log',
  tags: ['Platform'],
  summary: 'Audit log, newest first',
  middleware: orgAccess('audit:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(AuditEntry).openapi('AuditLogPage'), 'A page of audit entries'),
    ...errors(400, 401, 403, 404),
  },
});

export const platformRoutes = createRouter()
  .openapi(healthRoute, (c) => c.json({ ok: true as const, environment: c.env.ENVIRONMENT }, 200))
  .openapi(getJobRoute, async (c) => {
    const job = await service.getJob(orgCtx(c), c.var.membership.role, c.req.valid('param').jobId);
    return c.json(job, 200);
  })
  .openapi(auditLogRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    const rows = await repo.listAudit(orgCtx(c), limit, decodeCursor(cursor));
    const { data, nextCursor } = toPage(rows, limit);
    return c.json(
      {
        data: data.map(({ orgId: _org, ...entry }) => ({
          ...entry,
          before: entry.before ?? null,
          after: entry.after ?? null,
        })),
        nextCursor,
      },
      200,
    );
  });
