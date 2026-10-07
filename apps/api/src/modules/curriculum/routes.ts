import { createRoute, z } from '@hono/zod-openapi';
import {
  CreateGradeLevel,
  CreateSubject,
  GradeLevel,
  GradeLevelList,
  GradeLevelOrder,
  PageQuery,
  Subject,
  UpdateGradeLevel,
  UpdateSubject,
  page,
} from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const GradeLevelParams = OrgParams.extend({
  gradeLevelId: z.string().openapi({ param: { name: 'gradeLevelId', in: 'path' } }),
});
const SubjectParams = OrgParams.extend({
  subjectId: z.string().openapi({ param: { name: 'subjectId', in: 'path' } }),
});
const deleted = { 204: { description: 'Deleted' } };

const listGradeLevelsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/grade-levels',
  tags: ['Curriculum'],
  summary: 'List grade levels, in order',
  description: 'Returns every grade level in the org’s order, not paged (at most 100).',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams },
  responses: {
    200: json(GradeLevelList, 'All grade levels, first to last'),
    ...errors(401, 403, 404),
  },
});

const createGradeLevelRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/grade-levels',
  tags: ['Curriculum'],
  summary: 'Add a grade level',
  description:
    'Added at the end of the order. Names are unique in the org, ignoring case (409). ' +
    'At most 100 grade levels (422).',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateGradeLevel) },
  responses: {
    201: json(GradeLevel, 'The new grade level'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const reorderGradeLevelsRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/grade-levels/order',
  tags: ['Curriculum'],
  summary: 'Reorder grade levels',
  description:
    'Send every grade level id once, in the new order. An unknown id is 404; a missing one is 422.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(GradeLevelOrder) },
  responses: {
    200: json(GradeLevelList, 'All grade levels in their new order'),
    ...errors(400, 401, 403, 404, 422),
  },
});

const updateGradeLevelRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/grade-levels/{gradeLevelId}',
  tags: ['Curriculum'],
  summary: 'Rename a grade level',
  description:
    'To move it, use PUT /grade-levels/order. Send the `updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: GradeLevelParams, body: jsonBody(UpdateGradeLevel) },
  responses: {
    200: json(GradeLevel, 'The updated grade level'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteGradeLevelRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/grade-levels/{gradeLevelId}',
  tags: ['Curriculum'],
  summary: 'Delete a grade level',
  middleware: orgAccess('org:write'),
  request: { params: GradeLevelParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404),
  },
});

const listSubjectsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/subjects',
  tags: ['Curriculum'],
  summary: 'List subjects',
  description: 'Oldest first.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(Subject).openapi('SubjectPage'), 'A page of subjects'),
    ...errors(400, 401, 403, 404),
  },
});

const createSubjectRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/subjects',
  tags: ['Curriculum'],
  summary: 'Add a subject',
  description: 'Names are unique in the org, ignoring case (409).',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateSubject) },
  responses: {
    201: json(Subject, 'The new subject'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const updateSubjectRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/subjects/{subjectId}',
  tags: ['Curriculum'],
  summary: 'Rename a subject',
  description: 'Send the `updatedAt` you last read; a newer one on the server returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: SubjectParams, body: jsonBody(UpdateSubject) },
  responses: {
    200: json(Subject, 'The updated subject'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteSubjectRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/subjects/{subjectId}',
  tags: ['Curriculum'],
  summary: 'Delete a subject',
  middleware: orgAccess('org:write'),
  request: { params: SubjectParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404),
  },
});

// PUT /grade-levels/order is registered before the /{gradeLevelId} routes so "order" is never
// read as an id.
export const curriculumRoutes = createRouter()
  .openapi(listGradeLevelsRoute, async (c) => {
    return c.json(await service.listGradeLevels(orgCtx(c)), 200);
  })
  .openapi(createGradeLevelRoute, async (c) => {
    return c.json(await service.createGradeLevel(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(reorderGradeLevelsRoute, async (c) => {
    return c.json(await service.reorderGradeLevels(orgCtx(c), c.req.valid('json').ids), 200);
  })
  .openapi(updateGradeLevelRoute, async (c) => {
    const { gradeLevelId } = c.req.valid('param');
    return c.json(
      await service.updateGradeLevel(orgCtx(c), gradeLevelId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deleteGradeLevelRoute, async (c) => {
    await service.deleteGradeLevel(orgCtx(c), c.req.valid('param').gradeLevelId);
    return c.body(null, 204);
  })
  .openapi(listSubjectsRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listSubjects(orgCtx(c), limit, cursor), 200);
  })
  .openapi(createSubjectRoute, async (c) => {
    return c.json(await service.createSubject(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateSubjectRoute, async (c) => {
    const { subjectId } = c.req.valid('param');
    return c.json(await service.updateSubject(orgCtx(c), subjectId, c.req.valid('json')), 200);
  })
  .openapi(deleteSubjectRoute, async (c) => {
    await service.deleteSubject(orgCtx(c), c.req.valid('param').subjectId);
    return c.body(null, 204);
  });
