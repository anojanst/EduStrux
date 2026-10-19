import { createRoute, z } from '@hono/zod-openapi';
import { ClassEmergencyContacts, MarkAttendance, SessionAttendance } from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const SessionParams = OrgParams.extend({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }),
});

// Who reaches what: the owner every session; branch managers and front desk their branches'
// sessions; a teacher the sessions of the classes they teach, to read and to mark; a parent their
// own children's records, read-only. A session outside the caller's reach is 404. A class's
// emergency contacts follow the same reach, except that a parent gets 403 (D-112).

const getAttendanceRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}/attendance',
  tags: ['Attendance'],
  summary: 'Get a session’s attendance',
  description:
    'One record per student expected at the session: those with an active enrolment in the ' +
    'class that covers the session’s date, by last name then first name. `status` is null ' +
    'until the student is marked. A parent gets their own children’s records only.',
  middleware: orgAccess('attendance:read'),
  request: { params: SessionParams },
  responses: {
    200: json(SessionAttendance, 'The session’s roster with each student’s status'),
    ...errors(401, 403, 404),
  },
});

const markAttendanceRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}/attendance',
  tags: ['Attendance'],
  summary: 'Mark a session’s attendance',
  description:
    'Send one student, some or the whole class. Each one takes the status sent, `null` clears ' +
    'a mark, and anyone left out keeps theirs, so the last mark for a student wins. A session ' +
    'can be marked from its own day on (422 before), not once it is cancelled (422), and only ' +
    'for students enrolled in the class on that date (422). A teacher marks the classes they ' +
    'teach.',
  middleware: orgAccess('attendance:write'),
  request: { params: SessionParams, body: jsonBody(MarkAttendance) },
  responses: {
    200: json(SessionAttendance, 'The session’s roster after the change'),
    ...errors(400, 401, 403, 404, 422),
  },
});

const ClassParams = OrgParams.extend({
  classId: z.string().openapi({ param: { name: 'classId', in: 'path' } }),
});

const getEmergencyContactsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/classes/{classId}/emergency-contacts',
  tags: ['Attendance'],
  summary: 'Get a class’s emergency contacts',
  description:
    'Every student with an active enrolment in the class, by last name then first name, each ' +
    'with the guardians of their family marked as emergency contacts: name, relationship and ' +
    'phone. Children whose family belongs to another branch are included, so the class’s ' +
    'branch can call their guardians without seeing the rest of the family. Read only. A ' +
    'teacher gets the classes they teach; a parent gets 403.',
  middleware: orgAccess('attendance:read'),
  request: { params: ClassParams },
  responses: {
    200: json(ClassEmergencyContacts, 'The class’s students and who to call for each'),
    ...errors(401, 403, 404),
  },
});

export const attendanceRoutes = createRouter()
  .openapi(getAttendanceRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(await service.getAttendance(orgCtx(c), access(c), sessionId), 200);
  })
  .openapi(markAttendanceRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await service.markAttendance(orgCtx(c), access(c), sessionId, c.req.valid('json')),
      200,
    );
  })
  .openapi(getEmergencyContactsRoute, async (c) => {
    const { classId } = c.req.valid('param');
    return c.json(await service.emergencyContacts(orgCtx(c), access(c), classId), 200);
  });
