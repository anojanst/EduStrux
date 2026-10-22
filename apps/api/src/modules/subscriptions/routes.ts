import { createRoute } from '@hono/zod-openapi';
import { BillingOverview, BillingPortal, Checkout, CreateCheckout } from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

// The org's own subscription (TUI-73). Owner only (`org:write`), and open while the org is
// read-only, as subscribing is how it stops being so (TUI-74).

const getSubscriptionRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/billing/subscription',
  tags: ['Subscription'],
  summary: 'The organisation’s plan and subscription',
  description:
    'The plan, the org’s status, whether it can change anything (`canWrite`: false once a trial ' +
    'ends with no subscription, or while suspended or cancelled), the plan’s cap of active ' +
    'students and how many there are, and the Paddle subscription if any. Owner only.',
  middleware: orgAccess('org:write', { whileReadOnly: true }),
  request: { params: OrgParams },
  responses: { 200: json(BillingOverview, 'The plan'), ...errors(401, 403, 404) },
});

const checkoutRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/billing/checkout',
  tags: ['Subscription'],
  summary: 'Start a Paddle checkout for a plan',
  description:
    'Answers with a Paddle transaction for the plan and interval (monthly or yearly), for the ' +
    'web app to open with Paddle.js. Paying starts the subscription, which Paddle’s webhook ' +
    'records. An org with a live subscription changes it in the portal instead (422). 503 ' +
    'while Paddle isn’t set up or the plan has no price. Owner only.',
  middleware: orgAccess('org:write', { whileReadOnly: true }),
  request: { params: OrgParams, body: jsonBody(CreateCheckout) },
  responses: {
    201: json(Checkout, 'The checkout'),
    ...errors(400, 401, 403, 404, 422, 503),
  },
});

const portalRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/billing/portal',
  tags: ['Subscription'],
  summary: 'A link to Paddle’s customer portal',
  description:
    'Where the owner changes plan or card, sees receipts, or cancels. 422 with no subscription; ' +
    '503 while Paddle isn’t set up. Owner only.',
  middleware: orgAccess('org:write', { whileReadOnly: true }),
  request: { params: OrgParams },
  responses: { 200: json(BillingPortal, 'The link'), ...errors(401, 403, 404, 422, 503) },
});

export const subscriptionRoutes = createRouter()
  .openapi(getSubscriptionRoute, async (c) => c.json(await service.overview(orgCtx(c)), 200))
  .openapi(checkoutRoute, async (c) =>
    c.json(await service.checkout(orgCtx(c), c.env, c.req.valid('json')), 201),
  )
  .openapi(portalRoute, async (c) => c.json(await service.portal(orgCtx(c), c.env), 200));
