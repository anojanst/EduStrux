import { createRoute, z } from '@hono/zod-openapi';
import { CONSENT_TYPES, FamilyErased, SetConsent, StudentConsents } from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess, roleAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

// Privacy controls (TUI-79).

const StudentParams = OrgParams.extend({
  studentId: z.string().openapi({ param: { name: 'studentId', in: 'path' } }),
});
const ConsentParams = StudentParams.extend({
  type: z.enum(CONSENT_TYPES).openapi({ param: { name: 'type', in: 'path' } }),
});

const getConsentsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/students/{studentId}/consents',
  tags: ['Privacy'],
  summary: 'A student’s consents',
  description:
    'Every consent type (`photos`, `medical_treatment`) with what was recorded, or ' +
    '`granted: null` when nobody has been asked. For whoever reads the student: a teacher ' +
    'sees their own students’, a parent their children’s.',
  middleware: orgAccess('people:read'),
  request: { params: StudentParams },
  responses: { 200: json(StudentConsents, 'The consents'), ...errors(401, 403, 404) },
});

const setConsentRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/students/{studentId}/consents/{type}',
  tags: ['Privacy'],
  summary: 'Record a consent given or refused',
  description:
    'Replaces what was recorded for the type; the audit log keeps the history. `guardianId` ' +
    'is who gave it, one of the family’s guardians (400 otherwise).',
  middleware: orgAccess('people:write'),
  request: { params: ConsentParams, body: jsonBody(SetConsent) },
  responses: { 200: json(StudentConsents, 'The consents'), ...errors(400, 401, 402, 403, 404) },
});

const portalSetConsentRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/portal/students/{studentId}/consents/{type}',
  tags: ['Parent portal'],
  summary: 'Give or refuse a consent for my child',
  description:
    'Parents only. Recorded as given by the parent’s own guardian record; `guardianId` is ' +
    'ignored. Another family’s child is 404.',
  middleware: roleAccess('parent', 'people:read'),
  request: { params: ConsentParams, body: jsonBody(SetConsent) },
  responses: { 200: json(StudentConsents, 'The consents'), ...errors(400, 401, 402, 403, 404) },
});

const eraseFamilyRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/families/{familyId}/erase',
  tags: ['Privacy'],
  summary: 'Erase a family for good',
  description:
    'Owner only, and can’t be undone. The family’s, its guardians’ and its students’ names and ' +
    'details are replaced or cleared everywhere, including the audit log’s copies, lesson ' +
    'notes, absence reasons, consents, invitations, message addresses and the enrolment ' +
    'requests that made it; all of them are deleted. Ids, the bank reference, invoices, ' +
    'payments and attendance stay, so the books add up. A family that still owes money, or ' +
    'whose students are still enrolled, is 422. Works on a family already deleted. Erasing ' +
    'again answers the same.',
  middleware: orgAccess('org:write'),
  request: {
    params: OrgParams.extend({
      familyId: z.string().openapi({ param: { name: 'familyId', in: 'path' } }),
    }),
  },
  responses: { 200: json(FamilyErased, 'Erased'), ...errors(401, 402, 403, 404, 422) },
});

export const privacyRoutes = createRouter()
  .openapi(getConsentsRoute, async (c) => {
    const { studentId } = c.req.valid('param');
    return c.json(await service.getConsents(orgCtx(c), access(c), studentId), 200);
  })
  .openapi(setConsentRoute, async (c) => {
    const { studentId, type } = c.req.valid('param');
    return c.json(
      await service.setConsent(orgCtx(c), access(c), studentId, type, c.req.valid('json')),
      200,
    );
  })
  .openapi(portalSetConsentRoute, async (c) => {
    const { studentId, type } = c.req.valid('param');
    return c.json(
      await service.setConsent(orgCtx(c), access(c), studentId, type, c.req.valid('json')),
      200,
    );
  })
  .openapi(eraseFamilyRoute, async (c) =>
    c.json(await service.eraseFamily(orgCtx(c), c.req.valid('param').familyId), 200),
  );
