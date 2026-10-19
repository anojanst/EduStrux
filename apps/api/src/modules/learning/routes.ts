import { createRoute, z } from '@hono/zod-openapi';
import { SessionNotes, UpdateSessionNotes } from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const SessionParams = OrgParams.extend({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }),
});

// Who reaches what, as for a session's attendance (D-073): the owner every session; branch
// managers and front desk their branches' sessions; a teacher the sessions of the classes they
// teach, to read and to write; a parent the homework and their own children's notes, read-only.
// A session outside the caller's reach is 404.

const getNotesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}/notes',
  tags: ['Lesson notes'],
  summary: 'Get a lesson’s notes',
  description:
    'The homework set for the class, and one record per student expected at the session: ' +
    'those with an active enrolment in the class that covers the session’s date, by last name ' +
    'then first name, plus anyone with a note. `note` is null when there is none. A parent ' +
    'gets the homework and their own children’s notes only.',
  middleware: orgAccess('attendance:read'),
  request: { params: SessionParams },
  responses: {
    200: json(SessionNotes, 'The lesson’s homework and notes'),
    ...errors(401, 403, 404),
  },
});

const updateNotesRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/sessions/{sessionId}/notes',
  tags: ['Lesson notes'],
  summary: 'Write a lesson’s notes',
  description:
    'Send the homework, some students’ notes, or both. `null` clears one, and anything left ' +
    'out keeps what it has. Notes can be written before, on or after the lesson’s day, but not ' +
    'for a cancelled session (422), and only for students enrolled in the class on that date ' +
    '(422). A teacher writes the classes they teach.',
  middleware: orgAccess('attendance:write'),
  request: { params: SessionParams, body: jsonBody(UpdateSessionNotes) },
  responses: {
    200: json(SessionNotes, 'The lesson’s homework and notes after the change'),
    ...errors(400, 401, 403, 404, 422),
  },
});

export const learningRoutes = createRouter()
  .openapi(getNotesRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(await service.getNotes(orgCtx(c), access(c), sessionId), 200);
  })
  .openapi(updateNotesRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await service.updateNotes(orgCtx(c), access(c), sessionId, c.req.valid('json')),
      200,
    );
  });
