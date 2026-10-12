import { createRoute, z } from '@hono/zod-openapi';
import {
  Course,
  CourseQuery,
  CreateCourse,
  CreateGradeLevel,
  CreateSubject,
  GradeLevel,
  GradeLevelList,
  GradeLevelOrder,
  PageQuery,
  Subject,
  UpdateCourse,
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
const CourseParams = OrgParams.extend({
  courseId: z.string().openapi({ param: { name: 'courseId', in: 'path' } }),
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
  description:
    'Refused (422) while a course is taught at this grade level or a student has been in it.',
  middleware: orgAccess('org:write'),
  request: { params: GradeLevelParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
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
  description: 'Refused (422) while a course teaches this subject.',
  middleware: orgAccess('org:write'),
  request: { params: SubjectParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

// Every role reads courses, like the rest of the setup data. The owner, branch managers and
// front desk write them (`classes:write`); a course has no branch, so that permission's branch
// scope doesn't apply and a change is org-wide.

const listCoursesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/courses',
  tags: ['Curriculum'],
  summary: 'List courses',
  description: 'Oldest first. Filter by `subjectId`, `gradeLevelId` or both; an unknown id is 404.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: CourseQuery },
  responses: {
    200: json(page(Course).openapi('CoursePage'), 'A page of courses'),
    ...errors(400, 401, 403, 404),
  },
});

const createCourseRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/courses',
  tags: ['Curriculum'],
  summary: 'Add a course',
  description:
    'A course is a subject taught at a grade level, optionally narrowed by curriculum and ' +
    'teaching medium. That combination is unique in the org, ignoring case (409). ' +
    'A default price must be in the organisation’s currency (400).',
  middleware: orgAccess('classes:write'),
  request: { params: OrgParams, body: jsonBody(CreateCourse) },
  responses: {
    201: json(Course, 'The new course'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const updateCourseRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/courses/{courseId}',
  tags: ['Curriculum'],
  summary: 'Update a course',
  description:
    'A course keeps its subject and grade level. Send null to clear a field. ' +
    'Send the `updatedAt` you last read; a newer one on the server returns 409.',
  middleware: orgAccess('classes:write'),
  request: { params: CourseParams, body: jsonBody(UpdateCourse) },
  responses: {
    200: json(Course, 'The updated course'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteCourseRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/courses/{courseId}',
  tags: ['Curriculum'],
  summary: 'Delete a course',
  description: 'Refused (422) while a class runs this course.',
  middleware: orgAccess('classes:write'),
  request: { params: CourseParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
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
  })
  .openapi(listCoursesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listCourses(orgCtx(c), limit, cursor, filter), 200);
  })
  .openapi(createCourseRoute, async (c) => {
    return c.json(await service.createCourse(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateCourseRoute, async (c) => {
    const { courseId } = c.req.valid('param');
    return c.json(await service.updateCourse(orgCtx(c), courseId, c.req.valid('json')), 200);
  })
  .openapi(deleteCourseRoute, async (c) => {
    await service.deleteCourse(orgCtx(c), c.req.valid('param').courseId);
    return c.body(null, 204);
  });
