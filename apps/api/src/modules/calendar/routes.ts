import { createRoute, z } from '@hono/zod-openapi';
import {
  AcademicYear,
  CreateAcademicYear,
  CreateHoliday,
  CreateTerm,
  Holiday,
  HolidayQuery,
  PageQuery,
  Term,
  TermQuery,
  UpdateAcademicYear,
  UpdateTerm,
  page,
} from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const AcademicYearParams = OrgParams.extend({
  academicYearId: z.string().openapi({ param: { name: 'academicYearId', in: 'path' } }),
});
const TermParams = OrgParams.extend({
  termId: z.string().openapi({ param: { name: 'termId', in: 'path' } }),
});
const HolidayParams = OrgParams.extend({
  holidayId: z.string().openapi({ param: { name: 'holidayId', in: 'path' } }),
});
const deleted = { 204: { description: 'Deleted' } };

const listAcademicYearsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/academic-years',
  tags: ['Calendar'],
  summary: 'List academic years',
  description: 'In start-date order.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(AcademicYear).openapi('AcademicYearPage'), 'A page of academic years'),
    ...errors(400, 401, 403, 404),
  },
});

const createAcademicYearRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/academic-years',
  tags: ['Calendar'],
  summary: 'Add an academic year',
  description:
    "Academic years can't overlap (422). Names are unique in the org, ignoring case (409). " +
    "Academic years can't be deleted.",
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateAcademicYear) },
  responses: {
    201: json(AcademicYear, 'The new academic year'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const updateAcademicYearRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/academic-years/{academicYearId}',
  tags: ['Calendar'],
  summary: 'Update an academic year',
  description:
    "New dates can't overlap another year or leave one of its terms outside (422). " +
    'Send the `updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: AcademicYearParams, body: jsonBody(UpdateAcademicYear) },
  responses: {
    200: json(AcademicYear, 'The updated academic year'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const listTermsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/terms',
  tags: ['Calendar'],
  summary: 'List terms',
  description:
    'In start-date order. Filter by `academicYearId`. Terms are optional: classes without one are billed monthly.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: TermQuery },
  responses: {
    200: json(page(Term).openapi('TermPage'), 'A page of terms'),
    ...errors(400, 401, 403, 404),
  },
});

const createTermRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/terms',
  tags: ['Calendar'],
  summary: 'Add a term',
  description:
    "A term sits inside its academic year and can't overlap the year's other terms (422). " +
    'Names are unique in the academic year, ignoring case (409).',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateTerm) },
  responses: {
    201: json(Term, 'The new term'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const updateTermRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/terms/{termId}',
  tags: ['Calendar'],
  summary: 'Update a term',
  description:
    'A term stays in its academic year. Send the `updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: TermParams, body: jsonBody(UpdateTerm) },
  responses: {
    200: json(Term, 'The updated term'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const deleteTermRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/terms/{termId}',
  tags: ['Calendar'],
  summary: 'Delete a term',
  middleware: orgAccess('org:write'),
  request: { params: TermParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404),
  },
});

const listHolidaysRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/holidays',
  tags: ['Calendar'],
  summary: 'List holidays',
  description:
    'In start-date order. `from`/`to` keep holidays that touch that range; `branchId` keeps ' +
    'the ones that close that branch (its own plus the organisation-wide ones).',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: HolidayQuery },
  responses: {
    200: json(page(Holiday).openapi('HolidayPage'), 'A page of holidays'),
    ...errors(400, 401, 403, 404),
  },
});

const createHolidayRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/holidays',
  tags: ['Calendar'],
  summary: 'Add a holiday',
  description:
    'A closed date range (a single day has the same start and end). Closes the whole ' +
    'organisation, or only `branchId`.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateHoliday) },
  responses: {
    201: json(Holiday, 'The new holiday'),
    ...errors(400, 401, 403, 404),
  },
});

const deleteHolidayRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/holidays/{holidayId}',
  tags: ['Calendar'],
  summary: 'Delete a holiday',
  middleware: orgAccess('org:write'),
  request: { params: HolidayParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404),
  },
});

export const calendarRoutes = createRouter()
  .openapi(listAcademicYearsRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listAcademicYears(orgCtx(c), limit, cursor), 200);
  })
  .openapi(createAcademicYearRoute, async (c) => {
    return c.json(await service.createAcademicYear(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateAcademicYearRoute, async (c) => {
    const { academicYearId } = c.req.valid('param');
    return c.json(
      await service.updateAcademicYear(orgCtx(c), academicYearId, c.req.valid('json')),
      200,
    );
  })
  .openapi(listTermsRoute, async (c) => {
    const { limit, cursor, academicYearId } = c.req.valid('query');
    return c.json(await service.listTerms(orgCtx(c), limit, cursor, academicYearId), 200);
  })
  .openapi(createTermRoute, async (c) => {
    return c.json(await service.createTerm(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateTermRoute, async (c) => {
    const { termId } = c.req.valid('param');
    return c.json(await service.updateTerm(orgCtx(c), termId, c.req.valid('json')), 200);
  })
  .openapi(deleteTermRoute, async (c) => {
    await service.deleteTerm(orgCtx(c), c.req.valid('param').termId);
    return c.body(null, 204);
  })
  .openapi(listHolidaysRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listHolidays(orgCtx(c), limit, cursor, filter), 200);
  })
  .openapi(createHolidayRoute, async (c) => {
    return c.json(await service.createHoliday(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(deleteHolidayRoute, async (c) => {
    await service.deleteHoliday(orgCtx(c), c.req.valid('param').holidayId);
    return c.body(null, 204);
  });
