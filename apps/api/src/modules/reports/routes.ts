import { createRoute } from '@hono/zod-openapi';
import { Dashboard, MAX_REPORT_DAYS, MoneyReport, MoneyReportQuery } from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const dashboardRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/reports/dashboard',
  tags: ['Reports'],
  summary: 'The home dashboard',
  description:
    'Counts for today, as far as you reach: branch staff their branches, a teacher their own ' +
    'classes. `money` is for the owner and branch managers only. A parent or an accountant ' +
    'gets 403.',
  middleware: orgAccess('reports:read'),
  request: { params: OrgParams },
  responses: { 200: json(Dashboard, 'The dashboard'), ...errors(401, 403, 404) },
});

const moneyRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/reports/money',
  tags: ['Reports'],
  summary: 'Money: invoiced vs received, aged debt, tax',
  description:
    `From \`from\` to \`to\` (both included, at most ${MAX_REPORT_DAYS} days): invoices issued ` +
    'against payments received, by month and by payment method, tax by rate on what was ' +
    'invoiced, and what is owed today by age. Branch managers see their branches’ families; ' +
    'the owner and accountants every family. Front desk, teachers and parents get 403.',
  middleware: orgAccess('reports:money'),
  request: { params: OrgParams, query: MoneyReportQuery },
  responses: { 200: json(MoneyReport, 'The report'), ...errors(400, 401, 403, 404) },
});

export const reportRoutes = createRouter()
  .openapi(dashboardRoute, async (c) => c.json(await service.dashboard(orgCtx(c), access(c)), 200))
  .openapi(moneyRoute, async (c) =>
    c.json(await service.moneyReport(orgCtx(c), access(c), c.req.valid('query')), 200),
  );
