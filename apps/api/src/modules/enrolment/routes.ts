import { createRoute } from '@hono/zod-openapi';
import { CreateEnrolment, Enrolment, EnrolmentQuery, page } from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

// Who reaches what: the owner every enrolment; branch managers and front desk the enrolments in
// their branches' classes and those of their branches' students; a teacher the enrolments in the
// classes they teach and a parent their own children's, both read-only. To enrol a student the
// caller must reach both the student and the class; either one out of reach is 404.

const listEnrolmentsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/enrolments',
  tags: ['Enrolment'],
  summary: 'List enrolments',
  description:
    'Oldest first. `classId` gives a class’s roster and `studentId` a student’s classes. Each ' +
    'enrolment carries the student’s name and the class’s name, course and branch. A ' +
    '`studentId` or `classId` the caller can’t reach is 404. Teachers get each enrolment ' +
    'without `priceOverride`.',
  middleware: orgAccess('classes:read'),
  request: { params: OrgParams, query: EnrolmentQuery },
  responses: {
    200: json(page(Enrolment).openapi('EnrolmentPage'), 'A page of enrolments'),
    ...errors(400, 401, 403, 404),
  },
});

const createEnrolmentRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/enrolments',
  tags: ['Enrolment'],
  summary: 'Enrol a student in a class',
  description:
    'The dates must fall inside the class’s (422); `startDate` defaults to today, or to the ' +
    'class’s first day when that is still to come. A student can hold one active enrolment in ' +
    'a class (409), and a class with a `capacity` refuses once its places are taken (422). ' +
    'Staff limited to some branches can only enrol their own branches’ students in their own ' +
    'branches’ classes: a student or class outside those is 404.',
  middleware: orgAccess('classes:write'),
  request: { params: OrgParams, body: jsonBody(CreateEnrolment) },
  responses: {
    201: json(Enrolment, 'The new enrolment'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

export const enrolmentRoutes = createRouter()
  .openapi(listEnrolmentsRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listEnrolments(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(createEnrolmentRoute, async (c) => {
    return c.json(await service.createEnrolment(orgCtx(c), access(c), c.req.valid('json')), 201);
  });
