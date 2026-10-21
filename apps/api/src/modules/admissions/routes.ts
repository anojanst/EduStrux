import { createRoute, z } from '@hono/zod-openapi';
import {
  ApproveEnrolmentRequest,
  CreateEnquiry,
  CreateEnrolmentRequest,
  Enquiry,
  EnquiryQuery,
  EnrolmentRequest,
  EnrolmentRequestQuery,
  PublicForm,
  Received,
  RejectEnrolmentRequest,
  UpdateEnquiry,
  page,
} from '@edustrux/shared';
import type { Context } from 'hono';
import { access, orgCtx } from '../../db/scope';
import type { AppEnv } from '../../env';
import { notFound } from '../../lib/errors';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { byOrg, idempotent } from '../../middleware/idempotency';
import { orgAccess } from '../../middleware/permission';
import * as orgs from '../orgs/service';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

// Public forms need no sign-in, and say nothing about what is on record: an org that doesn't
// exist or isn't taking sign-ups is 404, and a form a bot filled in is answered as if received.

const SlugParams = z.object({
  orgSlug: z.string().openapi({ param: { name: 'orgSlug', in: 'path' }, example: 'bright-minds' }),
});

async function publicOrg(c: Context<AppEnv>, slug: string) {
  const org = await orgs.publicOrg(c.var.db, slug);
  if (!org) throw notFound('Organisation');
  return service.publicCtx(c.var.db, org);
}

const formRoute = createRoute({
  method: 'get',
  path: '/api/v1/public/{orgSlug}/form',
  tags: ['Public forms'],
  summary: 'What the public forms offer',
  description:
    'The organisation’s name, branches, classes still running with their weekly times, and ' +
    'the subjects, grade levels and courses they teach. No sign-in.',
  security: [],
  request: { params: SlugParams },
  responses: { 200: json(PublicForm, 'The form’s choices'), ...errors(404) },
});

const enquiryRoute = createRoute({
  method: 'post',
  path: '/api/v1/public/{orgSlug}/enquiries',
  tags: ['Public forms'],
  summary: 'Send an enquiry',
  description:
    'No sign-in. At most 10 forms an hour from one address (429). Leave `website` empty; ' +
    '`turnstileToken` is needed once the organisation turns Turnstile on (400 without).',
  security: [],
  request: { params: SlugParams, body: jsonBody(CreateEnquiry) },
  responses: { 201: json(Received, 'Received'), ...errors(400, 404, 429) },
});

const requestRoute = createRoute({
  method: 'post',
  path: '/api/v1/public/{orgSlug}/enrolment-requests',
  tags: ['Public forms'],
  summary: 'Ask to enrol children',
  description:
    'A guardian and 1 to 10 children, each with the classes they want (from the form’s ' +
    'choices; an unknown one is 400). Staff approve or reject it. No sign-in; guarded as ' +
    'enquiries are.',
  security: [],
  request: { params: SlugParams, body: jsonBody(CreateEnrolmentRequest) },
  responses: { 201: json(Received, 'Received'), ...errors(400, 404, 429) },
});

const EnquiryParams = OrgParams.extend({
  enquiryId: z.string().openapi({ param: { name: 'enquiryId', in: 'path' } }),
});
const RequestParams = OrgParams.extend({
  requestId: z.string().openapi({ param: { name: 'requestId', in: 'path' } }),
});

const listEnquiriesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/enquiries',
  tags: ['Enrolment'],
  summary: 'List enquiries',
  description:
    'Newest first. Branch staff see those naming one of their branches, and those naming none. ' +
    'Teachers, parents and accountants get 403.',
  middleware: orgAccess('people:write'),
  request: { params: OrgParams, query: EnquiryQuery },
  responses: {
    200: json(page(Enquiry).openapi('EnquiryPage'), 'A page of enquiries'),
    ...errors(400, 401, 403, 404),
  },
});

const updateEnquiryRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/enquiries/{enquiryId}',
  tags: ['Enrolment'],
  summary: 'Mark an enquiry handled, or new again',
  middleware: orgAccess('people:write'),
  request: { params: EnquiryParams, body: jsonBody(UpdateEnquiry) },
  responses: { 200: json(Enquiry, 'The enquiry'), ...errors(400, 401, 403, 404, 409) },
});

const listRequestsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/enrolment-requests',
  tags: ['Enrolment'],
  summary: 'List enrolment requests',
  description:
    'Newest first, `?status` to filter. Branch staff see those naming one of their branches, ' +
    'and those naming none.',
  middleware: orgAccess('classes:write'),
  request: { params: OrgParams, query: EnrolmentRequestQuery },
  responses: {
    200: json(page(EnrolmentRequest).openapi('EnrolmentRequestPage'), 'A page of requests'),
    ...errors(400, 401, 403, 404),
  },
});

const approveRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/enrolment-requests/{requestId}/approve',
  tags: ['Enrolment'],
  summary: 'Approve an enrolment request',
  description:
    'Adds the family (or uses `familyId`, one on record, against duplicates), its guardian, ' +
    'the children and their enrolments, with the usual rules and your reach. A class that ' +
    'refuses one (full, already enrolled) is listed in `result.skipped`. A request already ' +
    'decided is 422. Takes an `Idempotency-Key`.',
  middleware: [...orgAccess('classes:write'), idempotent(byOrg)],
  request: { params: RequestParams, body: jsonBody(ApproveEnrolmentRequest) },
  responses: {
    200: json(EnrolmentRequest, 'The approved request, with what it made'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const rejectRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/enrolment-requests/{requestId}/reject',
  tags: ['Enrolment'],
  summary: 'Reject an enrolment request',
  description: 'With an optional reason, kept for staff. A request already decided is 422.',
  middleware: orgAccess('classes:write'),
  request: { params: RequestParams, body: jsonBody(RejectEnrolmentRequest) },
  responses: {
    200: json(EnrolmentRequest, 'The rejected request'),
    ...errors(400, 401, 403, 404, 422),
  },
});

const ip = (c: Context<AppEnv>) => c.req.header('CF-Connecting-IP') ?? null;

export const admissionRoutes = createRouter()
  .openapi(formRoute, async (c) => {
    const ctx = await publicOrg(c, c.req.valid('param').orgSlug);
    return c.json(await service.publicForm(ctx, ctx.org!), 200);
  })
  .openapi(enquiryRoute, async (c) => {
    const ctx = await publicOrg(c, c.req.valid('param').orgSlug);
    return c.json(await service.receiveEnquiry(ctx, c.env, ip(c), c.req.valid('json')), 201);
  })
  .openapi(requestRoute, async (c) => {
    const ctx = await publicOrg(c, c.req.valid('param').orgSlug);
    return c.json(await service.receiveRequest(ctx, c.env, ip(c), c.req.valid('json')), 201);
  })
  .openapi(listEnquiriesRoute, async (c) => {
    const { limit, cursor, status } = c.req.valid('query');
    return c.json(await service.listEnquiries(orgCtx(c), access(c), limit, cursor, status), 200);
  })
  .openapi(updateEnquiryRoute, async (c) => {
    const { enquiryId } = c.req.valid('param');
    return c.json(
      await service.updateEnquiry(orgCtx(c), access(c), enquiryId, c.req.valid('json')),
      200,
    );
  })
  .openapi(listRequestsRoute, async (c) => {
    const { limit, cursor, status } = c.req.valid('query');
    return c.json(await service.listRequests(orgCtx(c), access(c), limit, cursor, status), 200);
  })
  .openapi(approveRoute, async (c) => {
    const { requestId } = c.req.valid('param');
    return c.json(
      await service.approveRequest(orgCtx(c), access(c), requestId, c.req.valid('json')),
      200,
    );
  })
  .openapi(rejectRoute, async (c) => {
    const { requestId } = c.req.valid('param');
    return c.json(
      await service.rejectRequest(orgCtx(c), access(c), requestId, c.req.valid('json').reason),
      200,
    );
  });
