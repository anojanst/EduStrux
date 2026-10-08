import { branches, now, rooms, type Db } from '@edustrux/db';
import { and, asc, count, eq, gt, ne, sql } from 'drizzle-orm';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type BranchRow = typeof branches.$inferSelect;
export type NewBranchRow = typeof branches.$inferInsert;
export type BranchChanges = Partial<Pick<NewBranchRow, 'name' | 'address'>>;
export type RoomRow = typeof rooms.$inferSelect;
export type NewRoomRow = typeof rooms.$inferInsert;
export type RoomChanges = Partial<Pick<NewRoomRow, 'name' | 'capacity'>>;

// ── Branches ────────────────────────────────────────────────────────────────

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listBranches(ctx: OrgCtx, limit: number, afterId?: string) {
  return ctx.db
    .select()
    .from(branches)
    .where(inOrg(ctx, branches, afterId ? gt(branches.id, afterId) : undefined))
    .orderBy(asc(branches.id))
    .limit(limit + 1);
}

export function findBranch(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(branches)
    .where(inOrg(ctx, branches, eq(branches.id, id)))
    .get();
}

export async function countBranches(ctx: OrgCtx) {
  const row = await ctx.db.select({ n: count() }).from(branches).where(inOrg(ctx, branches)).get();
  return row?.n ?? 0;
}

/** Case-insensitive, among the org's branches that aren't deleted. */
export async function branchNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(
      inOrg(
        ctx,
        branches,
        sql`lower(${branches.name}) = lower(${name})`,
        exceptId ? ne(branches.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

/** The insert on its own, for a caller that batches it with other writes (org creation). */
export function insertBranchStatement(db: Db, branch: NewBranchRow) {
  return db.insert(branches).values(branch);
}

export async function insertBranch(ctx: OrgCtx, branch: NewBranchRow & { id: string }) {
  await writeWithAudit(ctx, [insertBranchStatement(ctx.db, branch)], {
    action: 'branch.created',
    entityType: 'branch',
    entityId: branch.id,
    after: branch,
  });
}

export async function updateBranch(ctx: OrgCtx, before: BranchRow, changes: BranchChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(branches)
        .set(changes)
        .where(inOrg(ctx, branches, eq(branches.id, before.id))),
    ],
    { action: 'branch.updated', entityType: 'branch', entityId: before.id, before, after: changes },
  );
}

export async function softDeleteBranch(ctx: OrgCtx, before: BranchRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(branches)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, branches, eq(branches.id, before.id))),
    ],
    { action: 'branch.deleted', entityType: 'branch', entityId: before.id, before },
  );
}

// ── Rooms ───────────────────────────────────────────────────────────────────

export function listRooms(ctx: OrgCtx, branchId: string, limit: number, afterId?: string) {
  return ctx.db
    .select()
    .from(rooms)
    .where(
      inOrg(ctx, rooms, eq(rooms.branchId, branchId), afterId ? gt(rooms.id, afterId) : undefined),
    )
    .orderBy(asc(rooms.id))
    .limit(limit + 1);
}

export function findRoom(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(rooms)
    .where(inOrg(ctx, rooms, eq(rooms.id, id)))
    .get();
}

export async function countRooms(ctx: OrgCtx, branchId: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(rooms)
    .where(inOrg(ctx, rooms, eq(rooms.branchId, branchId)))
    .get();
  return row?.n ?? 0;
}

/** Case-insensitive, among the branch's rooms that aren't deleted. */
export async function roomNameTaken(
  ctx: OrgCtx,
  branchId: string,
  name: string,
  exceptId?: string,
) {
  const row = await ctx.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      inOrg(
        ctx,
        rooms,
        and(eq(rooms.branchId, branchId), sql`lower(${rooms.name}) = lower(${name})`),
        exceptId ? ne(rooms.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertRoom(ctx: OrgCtx, room: NewRoomRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(rooms).values(room)], {
    action: 'room.created',
    entityType: 'room',
    entityId: room.id,
    after: room,
  });
}

export async function updateRoom(ctx: OrgCtx, before: RoomRow, changes: RoomChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(rooms)
        .set(changes)
        .where(inOrg(ctx, rooms, eq(rooms.id, before.id))),
    ],
    { action: 'room.updated', entityType: 'room', entityId: before.id, before, after: changes },
  );
}

export async function softDeleteRoom(ctx: OrgCtx, before: RoomRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(rooms)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, rooms, eq(rooms.id, before.id))),
    ],
    { action: 'room.deleted', entityType: 'room', entityId: before.id, before },
  );
}
