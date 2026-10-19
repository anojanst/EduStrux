import { createRoute, z } from '@hono/zod-openapi';
import {
  CreateFamily,
  CreateGuardian,
  CreateStudent,
  Family,
  FamilyQuery,
  Guardian,
  Student,
  StudentQuery,
  UpdateFamily,
  UpdateGuardian,
  UpdateStudent,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const FamilyParams = OrgParams.extend({
  familyId: z.string().openapi({ param: { name: 'familyId', in: 'path' } }),
});
const GuardianParams = OrgParams.extend({
  guardianId: z.string().openapi({ param: { name: 'guardianId', in: 'path' } }),
});
const StudentParams = OrgParams.extend({
  studentId: z.string().openapi({ param: { name: 'studentId', in: 'path' } }),
});
const deleted = { 204: { description: 'Deleted' } };

// Who reaches what: the owner every family; branch managers and front desk the families whose
// home branch is one of theirs; a parent the families they are a signed-in guardian of,
// read-only; a teacher the students enrolled in the classes they teach, with those students'
// families and guardians but not their siblings, read-only. Guardians and students are reached
// through their family, and anything outside the caller's reach is 404, like something that
// doesn't exist. A student's notes are for staff: parents get students without them (D-126).

const listFamiliesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/families',
  tags: ['People'],
  summary: 'List families',
  description:
    'In name order, each with its guardians and students. Branch staff see the families of ' +
    'their branches, a parent their own, and a teacher the families of the students in their ' +
    'classes, showing only those students. A `branchId` the org doesn’t have is 404. Parents ' +
    'get each student without `notes`.',
  middleware: orgAccess('people:read'),
  request: { params: OrgParams, query: FamilyQuery },
  responses: {
    200: json(page(Family).openapi('FamilyPage'), 'A page of families'),
    ...errors(400, 401, 403, 404),
  },
});

const createFamilyRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/families',
  tags: ['People'],
  summary: 'Add a family',
  description:
    'The household that is contacted and billed. It belongs to one home branch; branch staff ' +
    'can only add families to their own branches (403). Add its guardians and students next.',
  middleware: orgAccess('people:write'),
  request: { params: OrgParams, body: jsonBody(CreateFamily) },
  responses: {
    201: json(Family, 'The new family'),
    ...errors(400, 401, 403, 404),
  },
});

const getFamilyRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/families/{familyId}',
  tags: ['People'],
  summary: 'Get a family',
  description: 'Parents get each student without `notes`.',
  middleware: orgAccess('people:read'),
  request: { params: FamilyParams },
  responses: {
    200: json(Family, 'The family with its guardians and students'),
    ...errors(401, 403, 404),
  },
});

const updateFamilyRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/families/{familyId}',
  tags: ['People'],
  summary: 'Update a family',
  description:
    '`billingGuardianId` must be one of the family’s guardians (422). Branch staff can only ' +
    'move a family to one of their own branches (403). Send the `updatedAt` you last read; a ' +
    'newer one returns 409.',
  middleware: orgAccess('people:write'),
  request: { params: FamilyParams, body: jsonBody(UpdateFamily) },
  responses: {
    200: json(Family, 'The updated family'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const deleteFamilyRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/families/{familyId}',
  tags: ['People'],
  summary: 'Delete a family',
  description: 'Also deletes its guardians. Refused (422) while the family has students.',
  middleware: orgAccess('people:write'),
  request: { params: FamilyParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

const createGuardianRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/families/{familyId}/guardians',
  tags: ['People'],
  summary: 'Add a guardian to a family',
  description:
    'A parent, or anyone else to contact about the family’s students. The family’s first ' +
    'guardian becomes its billing contact.',
  middleware: orgAccess('people:write'),
  request: { params: FamilyParams, body: jsonBody(CreateGuardian) },
  responses: {
    201: json(Guardian, 'The new guardian'),
    ...errors(400, 401, 403, 404),
  },
});

const updateGuardianRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/guardians/{guardianId}',
  tags: ['People'],
  summary: 'Update a guardian',
  description:
    'A guardian stays in their family. Send null to clear a field. Send the `updatedAt` you ' +
    'last read; a newer one returns 409.',
  middleware: orgAccess('people:write'),
  request: { params: GuardianParams, body: jsonBody(UpdateGuardian) },
  responses: {
    200: json(Guardian, 'The updated guardian'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteGuardianRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/guardians/{guardianId}',
  tags: ['People'],
  summary: 'Delete a guardian',
  description:
    'Refused (422) for the family’s billing contact: make another guardian the billing ' +
    'contact first.',
  middleware: orgAccess('people:write'),
  request: { params: GuardianParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

const listStudentsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/students',
  tags: ['People'],
  summary: 'List students',
  description:
    'In last name, then first name order. `gradeLevelId` keeps students in that grade level ' +
    'in `academicYearId`, or in the current academic year. A filter id the org doesn’t have ' +
    'is 404. Parents get each student without `notes`.',
  middleware: orgAccess('people:read'),
  request: { params: OrgParams, query: StudentQuery },
  responses: {
    200: json(page(Student).openapi('StudentPage'), 'A page of students'),
    ...errors(400, 401, 403, 404),
  },
});

const createStudentRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/students',
  tags: ['People'],
  summary: 'Add a student to a family',
  description:
    'With a `gradeLevelId`, the student gets that grade level for `academicYearId`, or for ' +
    'the current academic year. That needs the org to have an academic year (422).',
  middleware: orgAccess('people:write'),
  request: { params: OrgParams, body: jsonBody(CreateStudent) },
  responses: {
    201: json(Student, 'The new student'),
    ...errors(400, 401, 403, 404, 422),
  },
});

const getStudentRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/students/{studentId}',
  tags: ['People'],
  summary: 'Get a student',
  description: 'Parents get the student without `notes`.',
  middleware: orgAccess('people:read'),
  request: { params: StudentParams },
  responses: {
    200: json(Student, 'The student with their grade history'),
    ...errors(401, 403, 404),
  },
});

const updateStudentRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/students/{studentId}',
  tags: ['People'],
  summary: 'Update a student',
  description:
    'A student stays in their family. `gradeLevelId` sets the grade level for ' +
    '`academicYearId`, or for the current academic year; null removes it. Send the ' +
    '`updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('people:write'),
  request: { params: StudentParams, body: jsonBody(UpdateStudent) },
  responses: {
    200: json(Student, 'The updated student'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const deleteStudentRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/students/{studentId}',
  tags: ['People'],
  summary: 'Delete a student',
  description: 'Also deletes their grade history. Refused (422) while the student has enrolments.',
  middleware: orgAccess('people:write'),
  request: { params: StudentParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

export const peopleRoutes = createRouter()
  .openapi(listFamiliesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listFamilies(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(createFamilyRoute, async (c) => {
    return c.json(await service.createFamily(orgCtx(c), access(c), c.req.valid('json')), 201);
  })
  .openapi(getFamilyRoute, async (c) => {
    const { familyId } = c.req.valid('param');
    return c.json(await service.getFamily(orgCtx(c), access(c), familyId), 200);
  })
  .openapi(updateFamilyRoute, async (c) => {
    const { familyId } = c.req.valid('param');
    return c.json(
      await service.updateFamily(orgCtx(c), access(c), familyId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deleteFamilyRoute, async (c) => {
    await service.deleteFamily(orgCtx(c), access(c), c.req.valid('param').familyId);
    return c.body(null, 204);
  })
  .openapi(createGuardianRoute, async (c) => {
    const { familyId } = c.req.valid('param');
    return c.json(
      await service.createGuardian(orgCtx(c), access(c), familyId, c.req.valid('json')),
      201,
    );
  })
  .openapi(updateGuardianRoute, async (c) => {
    const { guardianId } = c.req.valid('param');
    return c.json(
      await service.updateGuardian(orgCtx(c), access(c), guardianId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deleteGuardianRoute, async (c) => {
    await service.deleteGuardian(orgCtx(c), access(c), c.req.valid('param').guardianId);
    return c.body(null, 204);
  })
  .openapi(listStudentsRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listStudents(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(createStudentRoute, async (c) => {
    return c.json(await service.createStudent(orgCtx(c), access(c), c.req.valid('json')), 201);
  })
  .openapi(getStudentRoute, async (c) => {
    const { studentId } = c.req.valid('param');
    return c.json(await service.getStudent(orgCtx(c), access(c), studentId), 200);
  })
  .openapi(updateStudentRoute, async (c) => {
    const { studentId } = c.req.valid('param');
    return c.json(
      await service.updateStudent(orgCtx(c), access(c), studentId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deleteStudentRoute, async (c) => {
    await service.deleteStudent(orgCtx(c), access(c), c.req.valid('param').studentId);
    return c.body(null, 204);
  });
