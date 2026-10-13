import { createRoute, z } from '@hono/zod-openapi';
import {
  CreatePriceRule,
  CreateTaxRate,
  PageQuery,
  PriceRule,
  PriceRuleQuery,
  TaxRate,
  UpdatePriceRule,
  UpdateTaxRate,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const TaxRateParams = OrgParams.extend({
  taxRateId: z.string().openapi({ param: { name: 'taxRateId', in: 'path' } }),
});

const PriceRuleParams = OrgParams.extend({
  priceRuleId: z.string().openapi({ param: { name: 'priceRuleId', in: 'path' } }),
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
    'The tax number shown on invoices is the org’s `taxNumber`. `isDefault: true` makes this the ' +
    'rate for every price that doesn’t name its own, and takes the flag off the rate that had it.',
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
  description:
    'Send the `updatedAt` you last read; a newer one on the server returns 409. ' +
    '`isDefault: true` takes the default from the rate that had it; `false` leaves the org with ' +
    'no default.',
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
  description: 'Refused (422) while a price rule names this rate.',
  middleware: orgAccess('org:write'),
  request: { params: TaxRateParams },
  responses: {
    204: { description: 'Deleted' },
    ...errors(401, 403, 404, 422),
  },
});

const listPriceRulesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/price-rules',
  tags: ['Billing'],
  summary: 'List price rules',
  description:
    'Oldest first. `courseId` or `classId` keeps that course’s or class’s own rules; an unknown ' +
    'id is 404. Staff limited to some branches don’t see other branches’ class rules.',
  middleware: orgAccess('billing:read'),
  request: { params: OrgParams, query: PriceRuleQuery },
  responses: {
    200: json(page(PriceRule).openapi('PriceRulePage'), 'A page of price rules'),
    ...errors(400, 401, 403, 404),
  },
});

const createPriceRuleRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/price-rules',
  tags: ['Billing'],
  summary: 'Add a price rule',
  description:
    'Prices one class (`classId`), one course’s classes (`courseId`) or, with neither, every ' +
    'class. The most specific price wins: the class’s rule, the course’s rule, the course’s ' +
    'default price, then the org-wide rule; an enrolment’s price override replaces the amount ' +
    'and keeps the basis. `per_term` only fits a class in a term and `per_month` a class with ' +
    'no term (422 on a class that doesn’t fit). A target can’t have two rules that would price ' +
    'the same class (409). The price must be in the organisation’s currency (400).',
  middleware: orgAccess('billing:write'),
  request: { params: OrgParams, body: jsonBody(CreatePriceRule) },
  responses: {
    201: json(PriceRule, 'The new price rule'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const updatePriceRuleRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/price-rules/{priceRuleId}',
  tags: ['Billing'],
  summary: 'Update a price rule',
  description:
    'A rule keeps what it prices and its basis. `taxRateId: null` goes back to the ' +
    'organisation’s default tax rate. Send the `updatedAt` you last read; a newer one on the ' +
    'server returns 409.',
  middleware: orgAccess('billing:write'),
  request: { params: PriceRuleParams, body: jsonBody(UpdatePriceRule) },
  responses: {
    200: json(PriceRule, 'The updated price rule'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deletePriceRuleRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/price-rules/{priceRuleId}',
  tags: ['Billing'],
  summary: 'Delete a price rule',
  middleware: orgAccess('billing:write'),
  request: { params: PriceRuleParams },
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
  })
  .openapi(listPriceRulesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listPriceRules(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(createPriceRuleRoute, async (c) => {
    return c.json(await service.createPriceRule(orgCtx(c), access(c), c.req.valid('json')), 201);
  })
  .openapi(updatePriceRuleRoute, async (c) => {
    const { priceRuleId } = c.req.valid('param');
    return c.json(
      await service.updatePriceRule(orgCtx(c), access(c), priceRuleId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deletePriceRuleRoute, async (c) => {
    await service.deletePriceRule(orgCtx(c), access(c), c.req.valid('param').priceRuleId);
    return c.body(null, 204);
  });
