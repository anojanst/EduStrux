import { createRoute, z } from '@hono/zod-openapi';
import {
  CLASH_RANGE_DAYS,
  Clash,
  ClashQuery,
  Class,
  ClassQuery,
  CreateClass,
  ScheduleResult,
  Session,
  SessionQuery,
  SessionUpdate,
  SetSchedule,
  UpdateClass,
  UpdateSession,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const ClassParams = OrgParams.extend({
  classId: z.string().openapi({ param: { name: 'classId', in: 'path' } }),
});
const SessionParams = OrgParams.extend({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }),
});
const deleted = { 204: { description: 'Deleted' } };

// Who reaches what: the owner every class; branch managers and front desk the classes in their
// branches; a teacher the classes they teach and a parent the classes their children are
// enrolled in, both read-only. A class outside the caller's reach is 404, like one that doesn't
// exist.

const listClassesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/classes',
  tags: ['Classes'],
  summary: 'List classes',
  description:
    'Oldest first, with each class’s weekly schedule. Branch staff see their branches’ ' +
    'classes, teachers the classes they teach and parents the classes their children are ' +
    'enrolled in. A filter id the org doesn’t have is 404.',
  middleware: orgAccess('classes:read'),
  request: { params: OrgParams, query: ClassQuery },
  responses: {
    200: json(page(Class).openapi('ClassPage'), 'A page of classes'),
    ...errors(400, 401, 403, 404),
  },
});

const createClassRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/classes',
  tags: ['Classes'],
  summary: 'Add a class',
  description:
    'One group of a course. With a `termId` it runs for that term; without one it is ' +
    'open-ended from its `startDate`. The name is unique among the course’s classes in the ' +
    'same term and branch (409). Branch staff can only add classes in their own branches ' +
    '(403). Set its weekly times with PUT /classes/{classId}/schedule.',
  middleware: orgAccess('classes:write'),
  request: { params: OrgParams, body: jsonBody(CreateClass) },
  responses: {
    201: json(Class, 'The new class'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const getClassRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/classes/{classId}',
  tags: ['Classes'],
  summary: 'Get a class',
  middleware: orgAccess('classes:read'),
  request: { params: ClassParams },
  responses: {
    200: json(Class, 'The class with its weekly schedule'),
    ...errors(401, 403, 404),
  },
});

const updateClassRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/classes/{classId}',
  tags: ['Classes'],
  summary: 'Update a class',
  description:
    'A class keeps its course, term and branch. A new room or teacher also goes onto its ' +
    'upcoming sessions, and new dates add and remove upcoming sessions; sessions that have ' +
    'started never change. Send the `updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('classes:write'),
  request: { params: ClassParams, body: jsonBody(UpdateClass) },
  responses: {
    200: json(Class, 'The updated class'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const deleteClassRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/classes/{classId}',
  tags: ['Classes'],
  summary: 'Delete a class',
  description:
    'Also deletes its weekly schedule and all its sessions. Refused (422) while the class ' +
    'has enrolments or a price rule of its own.',
  middleware: orgAccess('classes:write'),
  request: { params: ClassParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

const setScheduleRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/classes/{classId}/schedule',
  tags: ['Classes'],
  summary: 'Set a class’s weekly schedule',
  description:
    'Send every weekly slot; an empty list clears the schedule. Upcoming sessions are brought ' +
    'in line: ones that already match are kept, others are removed, and missing ones are ' +
    'added, skipping holidays. Sessions that have started never change. A class in a term ' +
    'gets sessions to the end of the term; an open-ended class for the next 13 weeks. ' +
    'Sending the same slots again only tops the sessions up.',
  middleware: orgAccess('classes:write'),
  request: { params: ClassParams, body: jsonBody(SetSchedule) },
  responses: {
    200: json(ScheduleResult, 'The class, and what happened to its upcoming sessions'),
    ...errors(400, 401, 403, 404),
  },
});

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/sessions',
  tags: ['Classes'],
  summary: 'List sessions in a date range',
  description:
    'From `from` to `to` (both included), in date then start-time order. Dates and times are ' +
    'local to the organisation; `startsAt` and `endsAt` are the same moments in UTC. Branch ' +
    'staff see their branches’ sessions, teachers their own classes’ and parents their ' +
    'children’s classes’. `studentId` gives one student’s timetable: the sessions of the ' +
    'classes they are enrolled in, on the dates each enrolment covers.',
  middleware: orgAccess('classes:read'),
  request: { params: OrgParams, query: SessionQuery },
  responses: {
    200: json(page(Session).openapi('SessionPage'), 'A page of sessions'),
    ...errors(400, 401, 403, 404),
  },
});

const getSessionRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}',
  tags: ['Classes'],
  summary: 'Get a session',
  middleware: orgAccess('classes:read'),
  request: { params: SessionParams },
  responses: {
    200: json(Session, 'The session'),
    ...errors(401, 403, 404),
  },
});

const clashesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/timetable/clashes',
  tags: ['Classes'],
  summary: 'Find clashing lessons',
  description:
    'Pairs of scheduled lessons that overlap on a date: in one room, with one teacher, with a ' +
    'student enrolled in both on that date, or two courses of one grade level at once. Only the ' +
    'lessons the caller reaches are checked: branch staff their branches’, a teacher their own ' +
    `classes’. At most ${CLASH_RANGE_DAYS} days at a time (400). Not paged. A parent gets 403.`,
  middleware: orgAccess('classes:read'),
  request: { params: OrgParams, query: ClashQuery },
  responses: {
    200: json(z.object({ data: z.array(Clash) }).openapi('ClashList'), 'The clashes found'),
    ...errors(400, 401, 403, 404),
  },
});

const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}',
  tags: ['Classes'],
  summary: 'Move, change or cancel one lesson',
  description:
    'A one-off change to a lesson that hasn’t started (422 once it has): a new `date` or ' +
    '`startTime` (not one that has passed, 422; another of the class’s lessons there is 409), ' +
    '`endTime`, `roomId` (in the class’s branch, 422), `teacherId` (active staff, 422), or ' +
    '`status`. A moved lesson keeps `movedFrom`, and saving the weekly schedule again leaves it ' +
    'alone. The families of the students expected at it are sent a message when it moves, ' +
    'changes time, is cancelled or is back on, with `note` added, unless `notify` is false or ' +
    'the notification settings turn lesson changes off. Send the `updatedAt` you last read (409).',
  middleware: orgAccess('classes:write'),
  request: { params: SessionParams, body: jsonBody(UpdateSession) },
  responses: {
    200: json(SessionUpdate, 'The lesson, and the message families were sent'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

export const classRoutes = createRouter()
  .openapi(updateSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await service.updateSession(
        orgCtx(c),
        access(c),
        sessionId,
        c.req.valid('json'),
        c.env.EMAIL_QUEUE,
      ),
      200,
    );
  })
  .openapi(clashesRoute, async (c) => {
    return c.json({ data: await service.clashes(orgCtx(c), access(c), c.req.valid('query')) }, 200);
  })
  .openapi(listClassesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listClasses(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(createClassRoute, async (c) => {
    return c.json(await service.createClass(orgCtx(c), access(c), c.req.valid('json')), 201);
  })
  .openapi(getClassRoute, async (c) => {
    const { classId } = c.req.valid('param');
    return c.json(await service.getClass(orgCtx(c), access(c), classId), 200);
  })
  .openapi(updateClassRoute, async (c) => {
    const { classId } = c.req.valid('param');
    return c.json(
      await service.updateClass(orgCtx(c), access(c), classId, c.req.valid('json')),
      200,
    );
  })
  .openapi(deleteClassRoute, async (c) => {
    await service.deleteClass(orgCtx(c), access(c), c.req.valid('param').classId);
    return c.body(null, 204);
  })
  .openapi(setScheduleRoute, async (c) => {
    const { classId } = c.req.valid('param');
    return c.json(
      await service.setSchedule(orgCtx(c), access(c), classId, c.req.valid('json')),
      200,
    );
  })
  .openapi(listSessionsRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listSessions(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(getSessionRoute, async (c) => {
    return c.json(
      await service.getSession(orgCtx(c), access(c), c.req.valid('param').sessionId),
      200,
    );
  });
