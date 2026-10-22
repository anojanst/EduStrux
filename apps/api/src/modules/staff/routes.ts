import { createRoute, z } from '@hono/zod-openapi';
import {
  AcceptedInvitation,
  CreatedInvitation,
  CreateInvitation,
  InvitationPreview,
  InviteGuardian,
  PageQuery,
  StaffMember,
  UpdateStaffMember,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { requireAuth } from '../../middleware/auth';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const MemberParams = OrgParams.extend({
  membershipId: z.string().openapi({ param: { name: 'membershipId', in: 'path' } }),
});
const GuardianParams = OrgParams.extend({
  guardianId: z.string().openapi({ param: { name: 'guardianId', in: 'path' } }),
});
const TokenParams = z.object({
  token: z
    .string()
    .min(1)
    .max(200)
    .openapi({ param: { name: 'token', in: 'path' } }),
});

const listStaffRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/staff',
  tags: ['Staff'],
  summary: 'List staff',
  description:
    'Every member but parents, oldest first, with their name and email. Branch managers ' +
    'limited to some branches see the branch managers, front desk and teachers whose branches ' +
    'are all theirs.',
  middleware: orgAccess('staff:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(StaffMember).openapi('StaffMemberPage'), 'A page of staff'),
    ...errors(400, 401, 403, 404),
  },
});

const inviteStaffRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/staff/invitations',
  tags: ['Staff'],
  summary: 'Invite a staff member',
  description:
    'Valid for 7 days. Answers with the token the person accepts with: invite emails are ' +
    'queued but not sent yet, so share it with them. A new invite to the same email withdraws ' +
    'the pending one. Branch managers limited to some branches give only the branch manager, ' +
    'front desk and teacher roles, with branches they have (403 otherwise). Owners and ' +
    'accountants take no `branchIds` (400). An unknown branch is 422; an email that is already ' +
    'a member is 409.',
  middleware: orgAccess('staff:write'),
  request: { params: OrgParams, body: jsonBody(CreateInvitation) },
  responses: {
    201: json(CreatedInvitation, 'The invite and its token'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const inviteGuardianRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/guardians/{guardianId}/invitation',
  tags: ['People'],
  summary: 'Invite a guardian to sign in as a parent',
  description:
    'Accepting it gives them a parent membership linked to this guardian, so they see the ' +
    'family. Sent to the guardian’s email unless `email` is given (422 when there is neither). ' +
    'A guardian who already signs in is 409. Valid for 7 days, with the token in the answer, ' +
    'as for staff invites.',
  middleware: orgAccess('people:write'),
  request: { params: GuardianParams, body: jsonBody(InviteGuardian) },
  responses: {
    201: json(CreatedInvitation, 'The invite and its token'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const previewInvitationRoute = createRoute({
  method: 'get',
  path: '/api/v1/invitations/{token}',
  tags: ['Staff'],
  summary: 'Look at an invitation before accepting it',
  description:
    'No sign-in: the invite link shows who invited the person and as what, and pre-fills the ' +
    'address on the sign-up form. An unknown or withdrawn token is 404. A used or expired ' +
    'invite still answers, with its `status`.',
  request: { params: TokenParams },
  responses: {
    200: json(InvitationPreview, 'The invitation'),
    ...errors(400, 404),
  },
});

const acceptInvitationRoute = createRoute({
  method: 'post',
  path: '/api/v1/invitations/{token}/accept',
  tags: ['Staff'],
  summary: 'Accept an invitation',
  description:
    'Joins the signed-in user to the org with the invite’s role and branches. The token alone ' +
    'is the proof: the signed-in email isn’t checked. An unknown or withdrawn token is 404; a ' +
    'used or expired one 422. A member of the org is 409, except a parent accepting another ' +
    'guardian’s invite, who keeps their membership and gains that family.',
  middleware: [requireAuth],
  request: { params: TokenParams },
  responses: {
    200: json(AcceptedInvitation, 'The membership joined'),
    ...errors(401, 404, 409, 422),
  },
});

const updateStaffRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/staff/{membershipId}',
  tags: ['Staff'],
  summary: 'Change a member’s role, branches or status',
  description:
    'Send the `updatedAt` you last read. Owners and accountants keep no branch list. Your own ' +
    'membership, and the last active owner’s role or status, can’t change (422). A parent’s ' +
    'membership changes only status (422). Branch managers limit as for invites (403), and ' +
    'members outside their reach are 404.',
  middleware: orgAccess('staff:write'),
  request: { params: MemberParams, body: jsonBody(UpdateStaffMember) },
  responses: {
    200: json(StaffMember, 'The member'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const removeStaffRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/staff/{membershipId}',
  tags: ['Staff'],
  summary: 'Remove a member',
  description:
    'Refused (422) for your own membership, the last active owner, and anyone who still ' +
    'teaches a class: give the class another teacher, or suspend them instead. Removing a ' +
    'parent unlinks their guardians, so they no longer see those families.',
  middleware: orgAccess('staff:write'),
  request: { params: MemberParams },
  responses: {
    204: { description: 'Removed' },
    ...errors(401, 403, 404, 422),
  },
});

export const staffRoutes = createRouter()
  .openapi(listStaffRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listStaff(orgCtx(c), access(c), limit, cursor), 200);
  })
  .openapi(inviteStaffRoute, async (c) => {
    return c.json(
      await service.inviteStaff(orgCtx(c), access(c), c.env.EMAIL_QUEUE, c.req.valid('json')),
      201,
    );
  })
  .openapi(inviteGuardianRoute, async (c) => {
    const { guardianId } = c.req.valid('param');
    return c.json(
      await service.inviteGuardian(
        orgCtx(c),
        access(c),
        c.env.EMAIL_QUEUE,
        guardianId,
        c.req.valid('json'),
      ),
      201,
    );
  })
  .openapi(previewInvitationRoute, async (c) => {
    const { token } = c.req.valid('param');
    return c.json(await service.previewInvitation(c.var.db, token), 200);
  })
  .openapi(acceptInvitationRoute, async (c) => {
    const { token } = c.req.valid('param');
    return c.json(await service.acceptInvitation(c.var.db, c.var.user, token), 200);
  })
  .openapi(updateStaffRoute, async (c) => {
    const { membershipId } = c.req.valid('param');
    return c.json(
      await service.updateStaffMember(orgCtx(c), access(c), membershipId, c.req.valid('json')),
      200,
    );
  })
  .openapi(removeStaffRoute, async (c) => {
    await service.removeStaffMember(orgCtx(c), access(c), c.req.valid('param').membershipId);
    return c.body(null, 204);
  });
