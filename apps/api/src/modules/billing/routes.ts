import { createRoute, z } from '@hono/zod-openapi';
import { CreateTaxRate, PageQuery, TaxRate, UpdateTaxRate, page } from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const TaxRateParams = OrgParams.extend({
  taxRateId: z.string().openapi({ param: { name: 'taxRateId', in: 'path' } }),
});

const listTaxRatesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/tax-rates',
  tags: ['Billing'],
  summary: 'List tax rates',
  description: 'Oldest first. No tax rates means no tax is charged, which is a valid setup.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(TaxRate).openapi('TaxRatePage'), 'A page of tax rates'),
    ...errors(400, 401, 403, 404),
  },
});

const createTaxRateRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/tax-rates',
  tags: ['Billing'],
  summary: 'Add a tax rate',
  description:
    '`rateBps` is the rate in basis points (1500 = 15%). Names are unique in the org, ignoring case (409). ' +
    'The tax number shown on invoices is the org’s `taxNumber`.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateTaxRate) },
  responses: {
    201: json(TaxRate, 'The new tax rate'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const updateTaxRateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/tax-rates/{taxRateId}',
  tags: ['Billing'],
  summary: 'Update a tax rate',
  description: 'Send the `updatedAt` you last read; a newer one on the server returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: TaxRateParams, body: jsonBody(UpdateTaxRate) },
  responses: {
    200: json(TaxRate, 'The updated tax rate'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteTaxRateRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/tax-rates/{taxRateId}',
  tags: ['Billing'],
  summary: 'Delete a tax rate',
  middleware: orgAccess('org:write'),
  request: { params: TaxRateParams },
  responses: {
    204: { description: 'Deleted' },
    ...errors(401, 403, 404),
  },
});

export const billingRoutes = createRouter()
  .openapi(listTaxRatesRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listTaxRates(orgCtx(c), limit, cursor), 200);
  })
  .openapi(createTaxRateRoute, async (c) => {
    return c.json(await service.createTaxRate(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateTaxRateRoute, async (c) => {
    const { taxRateId } = c.req.valid('param');
    return c.json(await service.updateTaxRate(orgCtx(c), taxRateId, c.req.valid('json')), 200);
  })
  .openapi(deleteTaxRateRoute, async (c) => {
    await service.deleteTaxRate(orgCtx(c), c.req.valid('param').taxRateId);
    return c.body(null, 204);
  });
