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
import * as classes from '../classes/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
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

export async function getBranch(ctx: OrgCtx, id: string): Promise<Branch> {
  const row = await repo.findBranch(ctx, id);
  if (!row) throw notFound('Branch');
  return toBranch(row);
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

  const row = await repo.insertBranch(ctx, {
    id: newId('branch'),
    orgId: ctx.orgId,
    name: input.name,
    address: input.address ?? null,
  });
  return toBranch(row);
}

export async function updateBranch(ctx: OrgCtx, id: string, input: UpdateBranch): Promise<Branch> {
  const { updatedAt, ...changes } = input;
  // The name check needs nothing from the branch's row, so both reads go to D1 together.
  const [before, taken] = await Promise.all([
    repo.findBranch(ctx, id),
    changes.name !== undefined ? repo.branchNameTaken(ctx, changes.name, id) : false,
  ]);
  if (!before) throw notFound('Branch');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toBranch(before);
  if (taken) throw nameTaken();

  const updated = await repo.updateBranch(ctx, before, changes);
  if (!updated) throw notFound('Branch');
  return toBranch(updated);
}

/**
 * Soft-deletes a branch. Refused while anything still depends on it: the org must keep one
 * branch; its rooms, classes and own holidays must be deleted first; and the families whose home
 * it is, and staff limited to it, must be moved first.
 */
export async function deleteBranch(ctx: OrgCtx, id: string): Promise<void> {
  // None of these reads needs another's answer, so they go to D1 together. The checks below
  // still run in the same order, so the same one is reported when several would refuse.
  const [before, branchCount, roomCount, classCount, familyCount, holidayCount, staffCount] =
    await Promise.all([
      repo.findBranch(ctx, id),
      repo.countBranches(ctx),
      repo.countRooms(ctx, id),
      classes.countClasses(ctx, { branchId: id }),
      people.countFamilies(ctx, id),
      calendar.countBranchHolidays(ctx, id),
      orgs.countMembersLimitedToBranch(ctx, id),
    ]);
  if (!before) throw notFound('Branch');

  if (branchCount <= 1) {
    throw unprocessable('An organisation needs at least one branch.');
  }
  if (roomCount > 0) {
    throw unprocessable(`Delete this branch's ${roomCount} room(s) first.`);
  }
  if (classCount > 0) {
    throw unprocessable(`Delete this branch's ${classCount} class(es) first.`);
  }
  if (familyCount > 0) {
    throw unprocessable(
      `${familyCount} family(ies) have this as their home branch. Move them to another branch first.`,
    );
  }
  if (holidayCount > 0) {
    throw unprocessable(`Delete this branch's ${holidayCount} holiday(s) first.`);
  }
  if (staffCount > 0) {
    throw unprocessable(
      `${staffCount} staff member(s) are limited to this branch. Change their branches first.`,
    );
  }

  await repo.softDeleteBranch(ctx, before);
}

// ── Rooms ───────────────────────────────────────────────────────────────────

export async function listRooms(ctx: OrgCtx, branchId: string, limit: number, cursor?: string) {
  const [branch, rows] = await Promise.all([
    repo.findBranch(ctx, branchId),
    repo.listRooms(ctx, branchId, limit, decodeCursor(cursor)),
  ]);
  if (!branch) throw notFound('Branch');
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toRoom), nextCursor };
}

export async function getRoom(ctx: OrgCtx, id: string): Promise<Room> {
  const row = await repo.findRoom(ctx, id);
  if (!row) throw notFound('Room');
  return toRoom(row);
}

export async function createRoom(ctx: OrgCtx, branchId: string, input: CreateRoom): Promise<Room> {
  const [branch, taken] = await Promise.all([
    repo.findBranch(ctx, branchId),
    repo.roomNameTaken(ctx, branchId, input.name),
  ]);
  if (!branch) throw notFound('Branch');
  if (taken) throw roomNameTaken();

  const row = await repo.insertRoom(ctx, {
    id: newId('room'),
    orgId: ctx.orgId,
    branchId,
    name: input.name,
    capacity: input.capacity ?? null,
  });
  return toRoom(row);
}

export async function updateRoom(ctx: OrgCtx, id: string, input: UpdateRoom): Promise<Room> {
  const { updatedAt, ...changes } = input;
  // The name check finds the room's branch itself, so it goes to D1 with the read of the room.
  const [before, taken] = await Promise.all([
    repo.findRoom(ctx, id),
    changes.name !== undefined ? repo.otherRoomHasName(ctx, id, changes.name) : false,
  ]);
  if (!before) throw notFound('Room');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toRoom(before);
  if (taken) throw roomNameTaken();

  const updated = await repo.updateRoom(ctx, before, changes);
  if (!updated) throw notFound('Room');
  return toRoom(updated);
}

/** Refused while a class is held in the room. */
export async function deleteRoom(ctx: OrgCtx, id: string): Promise<void> {
  const [before, classCount] = await Promise.all([
    repo.findRoom(ctx, id),
    classes.countClasses(ctx, { roomId: id }),
  ]);
  if (!before) throw notFound('Room');
  if (classCount > 0) {
    throw unprocessable(`${classCount} class(es) use this room. Move them to another room first.`);
  }
  await repo.softDeleteRoom(ctx, before);
}
