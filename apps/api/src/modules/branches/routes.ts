import { createRoute, z } from '@hono/zod-openapi';
import {
  Branch,
  CreateBranch,
  CreateRoom,
  PageQuery,
  Room,
  UpdateBranch,
  UpdateRoom,
  page,
} from '@edustrux/shared';
import { orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

const BranchParams = OrgParams.extend({
  branchId: z.string().openapi({ param: { name: 'branchId', in: 'path' } }),
});
const RoomParams = OrgParams.extend({
  roomId: z.string().openapi({ param: { name: 'roomId', in: 'path' } }),
});
const deleted = { 204: { description: 'Deleted' } };

const listBranchesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/branches',
  tags: ['Branches'],
  summary: 'List branches',
  description: 'Oldest first. Every org has at least one branch: "Main" is created with the org.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(Branch).openapi('BranchPage'), 'A page of branches'),
    ...errors(400, 401, 403, 404),
  },
});

const createBranchRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/branches',
  tags: ['Branches'],
  summary: 'Add a branch',
  description:
    'Names are unique in the org, ignoring case (409). Refused with 422 in single-tutor mode.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateBranch) },
  responses: {
    201: json(Branch, 'The new branch'),
    ...errors(400, 401, 403, 404, 409, 422),
  },
});

const updateBranchRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/branches/{branchId}',
  tags: ['Branches'],
  summary: 'Update a branch',
  description: 'Send the `updatedAt` you last read; a newer one on the server returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: BranchParams, body: jsonBody(UpdateBranch) },
  responses: {
    200: json(Branch, 'The updated branch'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteBranchRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/branches/{branchId}',
  tags: ['Branches'],
  summary: 'Delete a branch',
  description:
    'Refused with 422 if it is the last branch, still has rooms, or staff are limited to it.',
  middleware: orgAccess('org:write'),
  request: { params: BranchParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404, 422),
  },
});

const listRoomsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/branches/{branchId}/rooms',
  tags: ['Branches'],
  summary: "List a branch's rooms",
  description: 'Oldest first.',
  middleware: orgAccess('org:read'),
  request: { params: BranchParams, query: PageQuery },
  responses: {
    200: json(page(Room).openapi('RoomPage'), 'A page of rooms'),
    ...errors(400, 401, 403, 404),
  },
});

const createRoomRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/branches/{branchId}/rooms',
  tags: ['Branches'],
  summary: 'Add a room to a branch',
  description: 'Room names are unique in the branch, ignoring case (409).',
  middleware: orgAccess('org:write'),
  request: { params: BranchParams, body: jsonBody(CreateRoom) },
  responses: {
    201: json(Room, 'The new room'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const updateRoomRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/rooms/{roomId}',
  tags: ['Branches'],
  summary: 'Update a room',
  description:
    'A room stays in its branch. Send the `updatedAt` you last read; a newer one returns 409.',
  middleware: orgAccess('org:write'),
  request: { params: RoomParams, body: jsonBody(UpdateRoom) },
  responses: {
    200: json(Room, 'The updated room'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteRoomRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/rooms/{roomId}',
  tags: ['Branches'],
  summary: 'Delete a room',
  middleware: orgAccess('org:write'),
  request: { params: RoomParams },
  responses: {
    ...deleted,
    ...errors(401, 403, 404),
  },
});

export const branchRoutes = createRouter()
  .openapi(listBranchesRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listBranches(orgCtx(c), limit, cursor), 200);
  })
  .openapi(createBranchRoute, async (c) => {
    return c.json(await service.createBranch(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateBranchRoute, async (c) => {
    const { branchId } = c.req.valid('param');
    return c.json(await service.updateBranch(orgCtx(c), branchId, c.req.valid('json')), 200);
  })
  .openapi(deleteBranchRoute, async (c) => {
    await service.deleteBranch(orgCtx(c), c.req.valid('param').branchId);
    return c.body(null, 204);
  })
  .openapi(listRoomsRoute, async (c) => {
    const { branchId } = c.req.valid('param');
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listRooms(orgCtx(c), branchId, limit, cursor), 200);
  })
  .openapi(createRoomRoute, async (c) => {
    const { branchId } = c.req.valid('param');
    return c.json(await service.createRoom(orgCtx(c), branchId, c.req.valid('json')), 201);
  })
  .openapi(updateRoomRoute, async (c) => {
    const { roomId } = c.req.valid('param');
    return c.json(await service.updateRoom(orgCtx(c), roomId, c.req.valid('json')), 200);
  })
  .openapi(deleteRoomRoute, async (c) => {
    await service.deleteRoom(orgCtx(c), c.req.valid('param').roomId);
    return c.body(null, 204);
  });
