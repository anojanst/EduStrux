import { createRoute, z } from '@hono/zod-openapi';
import {
  AbsenceNotice,
  AbsenceNoticeQuery,
  ClassEmergencyContacts,
  CreateAbsenceNotice,
  CreateMakeupBooking,
  MakeupBooking,
  MakeupCredit,
  MakeupCreditQuery,
  MakeupPolicy,
  MarkAttendance,
  SessionAttendance,
  UpdateMakeupPolicy,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess, roleAccess } from '../../middleware/permission';
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

// Absence notices reach the students a caller reaches through enrolments: branch staff their
// branches' classes' students and their branches' students in any class, a teacher the students
// in their classes, a parent their own children (read here, given through the portal).

const listAbsenceNoticesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/absence-notices',
  tags: ['Attendance'],
  summary: 'List absence notices',
  description:
    'Oldest first. `from` and `to` keep the notices that overlap those dates (`to` before ' +
    '`from` is 400), and `studentId` one student’s; a student the caller can’t reach is 404. ' +
    'A parent gets their own children’s.',
  middleware: orgAccess('attendance:read'),
  request: { params: OrgParams, query: AbsenceNoticeQuery },
  responses: {
    200: json(page(AbsenceNotice).openapi('AbsenceNoticePage'), 'A page of absence notices'),
    ...errors(400, 401, 403, 404),
  },
});

const createAbsenceNoticeRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/absence-notices',
  tags: ['Attendance'],
  summary: 'Record an absence notice',
  description:
    'A student is, or was, away from `startDate` to `endDate` (both included; leave `endDate` ' +
    'out for one day, at most 366 days). The student shows as notified on the roster of every ' +
    'lesson of theirs in those dates. Nothing is marked: staff still set the status. A student ' +
    'the caller can’t reach is 404. Parents use `POST /portal/absence-notices`.',
  middleware: orgAccess('attendance:write'),
  request: { params: OrgParams, body: jsonBody(CreateAbsenceNotice) },
  responses: {
    201: json(AbsenceNotice, 'The new absence notice'),
    ...errors(400, 401, 403, 404),
  },
});

// ── Make-ups (TUI-55) ───────────────────────────────────────────────────────

const getPolicyRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/makeup-policy',
  tags: ['Attendance'],
  summary: 'Get the make-up policy',
  description: 'Off, with the defaults, until the owner saves it (`updatedAt: null`).',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams },
  responses: { 200: json(MakeupPolicy, 'The policy'), ...errors(401, 403, 404) },
});

const savePolicyRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/makeup-policy',
  tags: ['Attendance'],
  summary: 'Save the make-up policy',
  description:
    'Which marks earn a make-up credit, whether they need an absence notice given before the ' +
    'lesson, when credits lapse and whether a make-up must be the same course. The whole ' +
    'policy at once; the later save wins. It applies to marks made from then on. Owner only.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(UpdateMakeupPolicy) },
  responses: { 200: json(MakeupPolicy, 'The policy as saved'), ...errors(400, 401, 403, 404) },
});

const listCreditsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/makeup-credits',
  tags: ['Attendance'],
  summary: 'List make-up credits',
  description:
    'Newest first, for the students you reach, as for absence notices: branch staff the ' +
    'students in their branches’ classes and their branches’ students, a teacher their ' +
    'students, a parent their children. A credit is earned when a lesson is marked under the ' +
    'make-up policy, and taken back if the mark changes while it is unused. A `studentId` you ' +
    'can’t reach is 404.',
  middleware: orgAccess('attendance:read'),
  request: { params: OrgParams, query: MakeupCreditQuery },
  responses: {
    200: json(page(MakeupCredit).openapi('MakeupCreditPage'), 'A page of credits'),
    ...errors(400, 401, 403, 404),
  },
});

const bookRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/makeup-bookings',
  tags: ['Attendance'],
  summary: 'Book a make-up lesson',
  description:
    'Uses a credit to put its student on another lesson’s roster. The credit must be unused ' +
    'and not lapsed (422), and the lesson scheduled, still to come, before the credit lapses, ' +
    'of the same course when the policy says so, with a place free, and one the student isn’t ' +
    'already in (422). Booked twice is 409. A credit or lesson you can’t reach is 404.',
  middleware: orgAccess('classes:write'),
  request: { params: OrgParams, body: jsonBody(CreateMakeupBooking) },
  responses: {
    201: json(MakeupBooking, 'The booking'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const cancelBookingRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/makeup-bookings/{bookingId}',
  tags: ['Attendance'],
  summary: 'Cancel a make-up booking',
  description: 'Before its lesson starts (422 after). The credit can be used again.',
  middleware: orgAccess('classes:write'),
  request: {
    params: OrgParams.extend({
      bookingId: z.string().openapi({ param: { name: 'bookingId', in: 'path' } }),
    }),
  },
  responses: { 204: { description: 'Cancelled' }, ...errors(401, 403, 404, 422) },
});

const portalCreditsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/portal/makeup-credits',
  tags: ['Parent portal'],
  summary: 'My children’s make-up credits',
  description: 'Newest first. A `studentId` that isn’t one of your children is 404.',
  middleware: roleAccess('parent', 'attendance:read'),
  request: { params: OrgParams, query: MakeupCreditQuery },
  responses: {
    200: json(page(MakeupCredit).openapi('PortalMakeupCreditPage'), 'A page of credits'),
    ...errors(400, 401, 403, 404),
  },
});

export const attendanceRoutes = createRouter()
  .openapi(getPolicyRoute, async (c) => c.json(await service.getPolicy(orgCtx(c)), 200))
  .openapi(savePolicyRoute, async (c) =>
    c.json(await service.savePolicy(orgCtx(c), c.req.valid('json')), 200),
  )
  .openapi(listCreditsRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listCredits(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(portalCreditsRoute, async (c) => {
    const { limit, cursor, ...query } = c.req.valid('query');
    return c.json(await service.listCredits(orgCtx(c), access(c), limit, cursor, query), 200);
  })
  .openapi(bookRoute, async (c) =>
    c.json(await service.bookMakeup(orgCtx(c), access(c), c.req.valid('json')), 201),
  )
  .openapi(cancelBookingRoute, async (c) => {
    await service.cancelMakeup(orgCtx(c), access(c), c.req.valid('param').bookingId);
    return c.body(null, 204);
  })
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
  })
  .openapi(listAbsenceNoticesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(
      await service.listAbsenceNotices(orgCtx(c), access(c), limit, cursor, filter),
      200,
    );
  })
  .openapi(createAbsenceNoticeRoute, async (c) => {
    return c.json(
      await service.createAbsenceNotice(orgCtx(c), access(c), c.req.valid('json'), 'staff'),
      201,
    );
  });
