import { createRoute, z } from '@hono/zod-openapi';
import {
  AbsenceNotice,
  CreateAbsenceNotice,
  PortalChildList,
  PortalInvoice,
  PortalInvoiceQuery,
  PortalMessage,
  PortalSession,
  PortalSessionQuery,
  PageQuery,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { roleAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import { invoiceHtml, invoiceReference } from '../../pdf/documents';
import { DocumentQuery, documentResponse, sendDocument } from '../../pdf/respond';
import * as billing from '../billing/service';
import * as comms from '../comms/service';
import * as orgs from '../orgs/service';
import * as service from './service';

// The parent portal: a signed-in parent's view of their own family (D-126). Every route is for
// the parent role alone, and every other role gets 403. Each needs the permission the parent
// already reads the same data with, at `own` scope: people, classes or billing. Reporting an
// absence needs `absences:report`, which only parents (and the owner) hold.

const listChildrenRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/children',
  tags: ['Parent portal'],
  summary: 'List my children',
  description:
    'Every student of the families you are a guardian of, in name order, each with their ' +
    'family’s name and their active enrolments. The whole list is returned.',
  middleware: roleAccess('parent', 'people:read'),
  request: { params: OrgParams },
  responses: {
    200: json(PortalChildList, 'Your children'),
    ...errors(401, 403, 404),
  },
});

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/sessions',
  tags: ['Parent portal'],
  summary: 'My children’s timetable',
  description:
    'The sessions your children are enrolled for from `from` to `to` (both included), on the ' +
    'dates each enrolment covers, in date then start-time order. Cancelled sessions are ' +
    'included. Each names which of your children it is for. `studentId` gives one child’s; ' +
    'anyone else’s is 404.',
  middleware: roleAccess('parent', 'classes:read'),
  request: { params: OrgParams, query: PortalSessionQuery },
  responses: {
    200: json(page(PortalSession).openapi('PortalSessionPage'), 'A page of sessions'),
    ...errors(400, 401, 403, 404),
  },
});

const listInvoicesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/invoices',
  tags: ['Parent portal'],
  summary: 'My invoices',
  description:
    'Your families’ invoices once issued, newest first, each with `paid` and `balance`. A ' +
    'voided one stays, as void. `familyId` must be one of your families (404).',
  middleware: roleAccess('parent', 'billing:read'),
  request: { params: OrgParams, query: PortalInvoiceQuery },
  responses: {
    200: json(page(PortalInvoice).openapi('PortalInvoicePage'), 'A page of invoices'),
    ...errors(400, 401, 403, 404),
  },
});

const reportAbsenceRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/portal/absence-notices',
  tags: ['Parent portal'],
  summary: 'Report an absence',
  description:
    'One of your children is, or was, away from `startDate` to `endDate` (both included; leave ' +
    '`endDate` out for one day, at most 366 days). Their teachers and the centre see it on the ' +
    'roster of every lesson in those dates. Any other student is 404.',
  middleware: roleAccess('parent', 'absences:report'),
  request: { params: OrgParams, body: jsonBody(CreateAbsenceNotice) },
  responses: {
    201: json(AbsenceNotice, 'Your absence notice'),
    ...errors(400, 401, 403, 404),
  },
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/messages',
  tags: ['Parent portal'],
  summary: 'My messages',
  description:
    'Announcements and automatic messages sent to your families through the portal, newest ' +
    'first, each naming which of your families it went to.',
  middleware: roleAccess('parent', 'messages:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(PortalMessage).openapi('PortalMessagePage'), 'A page of messages'),
    ...errors(400, 401, 403, 404),
  },
});

const invoicePdfRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/invoices/{invoiceId}/pdf',
  tags: ['Parent portal'],
  summary: 'One of my invoices as a PDF',
  description:
    'An issued invoice of one of your families (a draft or another family’s is 404). ' +
    '`?format=html` gives the printable page. 503 while PDFs aren’t set up.',
  middleware: roleAccess('parent', 'billing:read'),
  request: {
    params: OrgParams.extend({
      invoiceId: z.string().openapi({ param: { name: 'invoiceId', in: 'path' } }),
    }),
    query: DocumentQuery,
  },
  responses: {
    200: documentResponse('The invoice'),
    ...errors(400, 401, 403, 404, 503),
  },
});

export const portalRoutes = createRouter()
  .openapi(invoicePdfRoute, async (c) => {
    const { invoiceId } = c.req.valid('param');
    const [invoice, org] = await Promise.all([
      billing.getInvoice(orgCtx(c), access(c), invoiceId),
      orgs.getOrg(orgCtx(c)),
    ]);
    const name = `invoice-${invoiceReference(invoice.id)}`;
    return sendDocument(c, invoiceHtml(org, invoice), name, c.req.valid('query').format);
  })
  .openapi(listMessagesRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(
      await comms.messagesForParent(orgCtx(c), c.var.membership.id, limit, cursor),
      200,
    );
  })
  .openapi(listChildrenRoute, async (c) => {
    const data = await service.listChildren(orgCtx(c), access(c));
    return c.json({ data, nextCursor: null }, 200);
  })
  .openapi(listSessionsRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listSessions(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(listInvoicesRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listInvoices(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(reportAbsenceRoute, async (c) => {
    return c.json(await service.reportAbsence(orgCtx(c), access(c), c.req.valid('json')), 201);
  });
