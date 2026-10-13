import { createRoute, z } from '@hono/zod-openapi';
import {
  CreatePriceRule,
  CreateTaxRate,
  GenerateInvoices,
  GenerateMonthlyInvoices,
  Invoice,
  InvoiceQuery,
  InvoiceRunResult,
  JobStarted,
  PageQuery,
  PriceRule,
  PriceRuleQuery,
  TaxRate,
  UpdateInvoice,
  UpdatePriceRule,
  UpdateTaxRate,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { byOrg, idempotent } from '../../middleware/idempotency';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import { startInvoiceRun } from './generation';
import * as service from './service';

const TaxRateParams = OrgParams.extend({
  taxRateId: z.string().openapi({ param: { name: 'taxRateId', in: 'path' } }),
});

const PriceRuleParams = OrgParams.extend({
  priceRuleId: z.string().openapi({ param: { name: 'priceRuleId', in: 'path' } }),
});

const TermParams = OrgParams.extend({
  termId: z.string().openapi({ param: { name: 'termId', in: 'path' } }),
});

const InvoiceParams = OrgParams.extend({
  invoiceId: z.string().openapi({ param: { name: 'invoiceId', in: 'path' } }),
});

/** A write that takes an `Idempotency-Key`: a retry with the same key replays the first answer. */
const billingAction = [...orgAccess('billing:write'), idempotent(byOrg)];

const RUN_RULES =
  'Makes one draft invoice per family, with a line for each enrolment billed. A term or month ' +
  'price is charged pro rata by lessons: the lessons the enrolment covers out of the lessons ' +
  'the class holds in the period. A per-lesson price is charged for each of those lessons. A ' +
  'pack is invoiced up front: enough packs to cover the lessons up to the end of the period. ' +
  'Free-trial lessons, cancelled lessons and holidays aren’t charged. An enrolment is invoiced ' +
  'once for a period, so running this again only bills what is new, and voiding an invoice ' +
  'frees its enrolments to be billed again. Staff limited to some branches bill the families ' +
  'whose home branch is theirs. Returns `202 { jobId }`: poll `GET /jobs/{jobId}`. Its ' +
  '`result` is an `InvoiceRunResult`: the invoices, lines and total made, `alreadyInvoiced`, ' +
  'and `skipped` with a `reason` for each enrolment left out (`no_price`, `no_lessons`, ' +
  '`free_trial`, `free`, `pack_covers`, `currency_mismatch`, `other_branch`). Takes an ' +
  '`Idempotency-Key`.';

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

const generateTermInvoicesRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/terms/{termId}/generate-invoices',
  tags: ['Billing'],
  summary: 'Generate a term’s invoices',
  description: `Bills the enrolments in the term’s classes. ${RUN_RULES}`,
  middleware: billingAction,
  request: {
    params: TermParams,
    body: { content: { 'application/json': { schema: GenerateInvoices } } },
  },
  responses: {
    202: json(JobStarted, 'The run was queued'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const generateMonthlyInvoicesRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/invoices/generate-monthly',
  tags: ['Billing'],
  summary: 'Generate a month’s invoices',
  description: `Bills the enrolments in the classes with no term, for one calendar month. ${RUN_RULES}`,
  middleware: billingAction,
  request: { params: OrgParams, body: jsonBody(GenerateMonthlyInvoices) },
  responses: {
    202: json(JobStarted, 'The run was queued'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const listInvoicesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/invoices',
  tags: ['Billing'],
  summary: 'List invoices',
  description:
    'Newest first, each with its lines. Filters: `familyId`, `branchId` (the family’s home ' +
    'branch), `termId`, `month` and `status`; an unknown id is 404. Staff limited to some ' +
    'branches see the invoices of the families whose home branch is theirs. A parent sees ' +
    'their own family’s invoices once they have been issued.',
  middleware: orgAccess('billing:read'),
  request: { params: OrgParams, query: InvoiceQuery },
  responses: {
    200: json(page(Invoice).openapi('InvoicePage'), 'A page of invoices'),
    ...errors(400, 401, 403, 404),
  },
});

const getInvoiceRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/invoices/{invoiceId}',
  tags: ['Billing'],
  summary: 'Get an invoice',
  middleware: orgAccess('billing:read'),
  request: { params: InvoiceParams },
  responses: {
    200: json(Invoice, 'The invoice'),
    ...errors(401, 403, 404),
  },
});

const updateInvoiceRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/invoices/{invoiceId}',
  tags: ['Billing'],
  summary: 'Update an invoice',
  description:
    'Changes the due date and the note. The lines are fixed: to bill differently, void the ' +
    'invoice and generate again. A void invoice can’t be changed (422). Send the `updatedAt` ' +
    'you last read; a newer one on the server returns 409.',
  middleware: orgAccess('billing:write'),
  request: { params: InvoiceParams, body: jsonBody(UpdateInvoice) },
  responses: {
    200: json(Invoice, 'The updated invoice'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const issueInvoiceRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/invoices/{invoiceId}/issue',
  tags: ['Billing'],
  summary: 'Issue an invoice',
  description:
    'A draft becomes `issued`, and the family’s parents can see it from then on. Anything but ' +
    'a draft is 422. Takes an `Idempotency-Key`.',
  middleware: billingAction,
  request: { params: InvoiceParams },
  responses: {
    200: json(Invoice, 'The issued invoice'),
    ...errors(401, 403, 404, 409, 422),
  },
});

const voidInvoiceRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/invoices/{invoiceId}/void',
  tags: ['Billing'],
  summary: 'Void an invoice',
  description:
    'A draft or an issued invoice becomes `void`, and its enrolments can be invoiced for the ' +
    'period again. One that is already void, or has payments on it, is 422. Takes an ' +
    '`Idempotency-Key`.',
  middleware: billingAction,
  request: { params: InvoiceParams },
  responses: {
    200: json(Invoice, 'The void invoice'),
    ...errors(401, 403, 404, 409, 422),
  },
});

const router = createRouter();
// A run's result comes back on its job, so no route returns it. Registered so the docs show it.
router.openAPIRegistry.register('InvoiceRunResult', InvoiceRunResult);

export const billingRoutes = router
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
  })
  .openapi(generateTermInvoicesRoute, async (c) => {
    const { termId } = c.req.valid('param');
    const { dueDate } = c.req.valid('json');
    const jobId = await startInvoiceRun(
      orgCtx(c),
      access(c),
      c.env.JOBS_QUEUE,
      { termId },
      dueDate ?? null,
    );
    return c.json({ jobId }, 202);
  })
  .openapi(generateMonthlyInvoicesRoute, async (c) => {
    const { month, dueDate } = c.req.valid('json');
    const jobId = await startInvoiceRun(
      orgCtx(c),
      access(c),
      c.env.JOBS_QUEUE,
      { month },
      dueDate ?? null,
    );
    return c.json({ jobId }, 202);
  })
  .openapi(listInvoicesRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listInvoices(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(getInvoiceRoute, async (c) => {
    const { invoiceId } = c.req.valid('param');
    return c.json(await service.getInvoice(orgCtx(c), access(c), invoiceId), 200);
  })
  .openapi(updateInvoiceRoute, async (c) => {
    const { invoiceId } = c.req.valid('param');
    return c.json(
      await service.updateInvoice(orgCtx(c), access(c), invoiceId, c.req.valid('json')),
      200,
    );
  })
  .openapi(issueInvoiceRoute, async (c) => {
    const { invoiceId } = c.req.valid('param');
    return c.json(await service.issueInvoice(orgCtx(c), access(c), invoiceId), 200);
  })
  .openapi(voidInvoiceRoute, async (c) => {
    const { invoiceId } = c.req.valid('param');
    return c.json(await service.voidInvoice(orgCtx(c), access(c), invoiceId), 200);
  });
