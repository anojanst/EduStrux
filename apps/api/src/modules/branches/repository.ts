import { branches, now, rooms, type Db } from '@edustrux/db';
import { and, asc, count, eq, gt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
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

/** Returns the branch as stored, from the same batch, so the caller doesn't read it back. */
export async function insertBranch(
  ctx: OrgCtx,
  branch: NewBranchRow & { id: string },
): Promise<BranchRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [insertBranchStatement(ctx.db, branch).returning()],
    { action: 'branch.created', entityType: 'branch', entityId: branch.id, after: branch },
  );
  const row = (inserted as BranchRow[])[0];
  if (!row) throw new Error('Branch missing after insert');
  return row;
}

/** Returns the branch as updated, from the same batch. undefined if it was just deleted. */
export async function updateBranch(
  ctx: OrgCtx,
  before: BranchRow,
  changes: BranchChanges,
): Promise<BranchRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(branches)
        .set(changes)
        .where(inOrg(ctx, branches, eq(branches.id, before.id)))
        .returning(),
    ],
    { action: 'branch.updated', entityType: 'branch', entityId: before.id, before, after: changes },
  );
  return (updated as BranchRow[])[0];
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
export async function roomNameTaken(ctx: OrgCtx, branchId: string, name: string) {
  const row = await ctx.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      inOrg(
        ctx,
        rooms,
        and(eq(rooms.branchId, branchId), sql`lower(${rooms.name}) = lower(${name})`),
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * Whether another room in this room's branch has the name. The branch comes from the room's own
 * row inside the statement, so this can be sent together with the read of the room.
 */
export async function otherRoomHasName(ctx: OrgCtx, id: string, name: string) {
  const self = alias(rooms, 'self');
  const row = await ctx.db
    .select({ id: rooms.id })
    .from(self)
    .innerJoin(
      rooms,
      inOrg(
        ctx,
        rooms,
        eq(rooms.branchId, self.branchId),
        sql`lower(${rooms.name}) = lower(${name})`,
        ne(rooms.id, self.id),
      ),
    )
    .where(inOrg(ctx, self, eq(self.id, id)))
    .get();
  return row !== undefined;
}

/** Returns the room as stored, from the same batch, so the caller doesn't read it back. */
export async function insertRoom(ctx: OrgCtx, room: NewRoomRow & { id: string }): Promise<RoomRow> {
  const [, inserted] = await writeWithAudit(ctx, [ctx.db.insert(rooms).values(room).returning()], {
    action: 'room.created',
    entityType: 'room',
    entityId: room.id,
    after: room,
  });
  const row = (inserted as RoomRow[])[0];
  if (!row) throw new Error('Room missing after insert');
  return row;
}

/** Returns the room as updated, from the same batch. undefined if it was just deleted. */
export async function updateRoom(
  ctx: OrgCtx,
  before: RoomRow,
  changes: RoomChanges,
): Promise<RoomRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(rooms)
        .set(changes)
        .where(inOrg(ctx, rooms, eq(rooms.id, before.id)))
        .returning(),
    ],
    { action: 'room.updated', entityType: 'room', entityId: before.id, before, after: changes },
  );
  return (updated as RoomRow[])[0];
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
