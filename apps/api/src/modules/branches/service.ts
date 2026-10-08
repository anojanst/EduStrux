import type { Db } from '@edustrux/db';
import {
  newId,
  type Branch,
  type CreateBranch,
  type CreateRoom,
  type Room,
  type UpdateBranch,
  type UpdateRoom,
} from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData, unprocessable } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as calendar from '../calendar/service';
import * as orgs from '../orgs/service';
import * as repo from './repository';

export const DEFAULT_BRANCH_NAME = 'Main';

export function toBranch(row: repo.BranchRow): Branch {
  const { orgId: _org, deletedAt: _deleted, ...branch } = row;
  return branch;
}

export function toRoom(row: repo.RoomRow): Room {
  const { orgId: _org, deletedAt: _deleted, ...room } = row;
  return room;
}

const nameTaken = () => conflict('A branch with that name already exists', { name: ['Taken'] });
const roomNameTaken = () =>
  conflict('A room with that name already exists in this branch', { name: ['Taken'] });

// ── Branches ────────────────────────────────────────────────────────────────

/**
 * The "Main" branch every org starts with. Returned as a row plus its insert, so org creation
 * can write it in the same batch as the org.
 */
export function defaultBranch(db: Db, orgId: string) {
  const row = { id: newId('branch'), orgId, name: DEFAULT_BRANCH_NAME, address: null };
  return { row, statement: repo.insertBranchStatement(db, row) };
}

export async function listBranches(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listBranches(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toBranch), nextCursor };
}

async function findBranchOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findBranch(ctx, id);
  if (!row) throw notFound('Branch');
  return row;
}

export async function getBranch(ctx: OrgCtx, id: string): Promise<Branch> {
  return toBranch(await findBranchOr404(ctx, id));
}

export function countBranches(ctx: OrgCtx) {
  return repo.countBranches(ctx);
}

export async function createBranch(ctx: OrgCtx, input: CreateBranch): Promise<Branch> {
  const org = await orgs.getOrg(ctx);
  if (org.singleTutorMode) {
    throw unprocessable('Single-tutor mode allows one branch. Turn it off to add branches.');
  }
  if (await repo.branchNameTaken(ctx, input.name)) throw nameTaken();

  const id = newId('branch');
  await repo.insertBranch(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    address: input.address ?? null,
  });
  return getBranch(ctx, id);
}

export async function updateBranch(ctx: OrgCtx, id: string, input: UpdateBranch): Promise<Branch> {
  const before = await findBranchOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toBranch(before);
  if (changes.name !== undefined && (await repo.branchNameTaken(ctx, changes.name, id))) {
    throw nameTaken();
  }

  await repo.updateBranch(ctx, before, changes);
  return getBranch(ctx, id);
}

/**
 * Soft-deletes a branch. Refused while anything still depends on it: the org must keep one
 * branch; its rooms and its own holidays must be deleted first; and staff limited to the
 * branch must be moved first.
 */
export async function deleteBranch(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findBranchOr404(ctx, id);

  if ((await repo.countBranches(ctx)) <= 1) {
    throw unprocessable('An organisation needs at least one branch.');
  }
  const roomCount = await repo.countRooms(ctx, id);
  if (roomCount > 0) {
    throw unprocessable(`Delete this branch's ${roomCount} room(s) first.`);
  }
  const holidayCount = await calendar.countBranchHolidays(ctx, id);
  if (holidayCount > 0) {
    throw unprocessable(`Delete this branch's ${holidayCount} holiday(s) first.`);
  }
  const staffCount = await orgs.countMembersLimitedToBranch(ctx, id);
  if (staffCount > 0) {
    throw unprocessable(
      `${staffCount} staff member(s) are limited to this branch. Change their branches first.`,
    );
  }

  await repo.softDeleteBranch(ctx, before);
}

// ── Rooms ───────────────────────────────────────────────────────────────────

export async function listRooms(ctx: OrgCtx, branchId: string, limit: number, cursor?: string) {
  await findBranchOr404(ctx, branchId);
  const rows = await repo.listRooms(ctx, branchId, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toRoom), nextCursor };
}

async function findRoomOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findRoom(ctx, id);
  if (!row) throw notFound('Room');
  return row;
}

export async function getRoom(ctx: OrgCtx, id: string): Promise<Room> {
  return toRoom(await findRoomOr404(ctx, id));
}

export async function createRoom(ctx: OrgCtx, branchId: string, input: CreateRoom): Promise<Room> {
  await findBranchOr404(ctx, branchId);
  if (await repo.roomNameTaken(ctx, branchId, input.name)) throw roomNameTaken();

  const id = newId('room');
  await repo.insertRoom(ctx, {
    id,
    orgId: ctx.orgId,
    branchId,
    name: input.name,
    capacity: input.capacity ?? null,
  });
  return getRoom(ctx, id);
}

export async function updateRoom(ctx: OrgCtx, id: string, input: UpdateRoom): Promise<Room> {
  const before = await findRoomOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toRoom(before);
  if (
    changes.name !== undefined &&
    (await repo.roomNameTaken(ctx, before.branchId, changes.name, id))
  ) {
    throw roomNameTaken();
  }

  await repo.updateRoom(ctx, before, changes);
  return getRoom(ctx, id);
}

export async function deleteRoom(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findRoomOr404(ctx, id);
  await repo.softDeleteRoom(ctx, before);
}
