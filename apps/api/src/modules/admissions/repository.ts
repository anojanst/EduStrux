import { enquiries, enrolmentRequests } from '@edustrux/db';
import { and, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { changedFields, inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type EnquiryRow = typeof enquiries.$inferSelect;
export type NewEnquiryRow = typeof enquiries.$inferInsert;
export type RequestRow = typeof enrolmentRequests.$inferSelect;
export type NewRequestRow = typeof enrolmentRequests.$inferInsert;

/** Branch staff see what names one of their branches, or no branch at all. */
export type Reach = { branchIds?: string[] };

const branchWithin = (
  column: typeof enquiries.branchId | typeof enrolmentRequests.branchId,
  reach: Reach,
) => (reach.branchIds ? or(isNull(column), inArray(column, reach.branchIds)) : undefined);

/** How many forms came from this address since the instant, enquiries and requests together. */
export async function sentSince(ctx: OrgCtx, ipHash: string, since: string) {
  const [a, b] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(enquiries)
      .where(inOrg(ctx, enquiries, eq(enquiries.ipHash, ipHash), gte(enquiries.createdAt, since)))
      .get(),
    ctx.db
      .select({ n: count() })
      .from(enrolmentRequests)
      .where(
        inOrg(
          ctx,
          enrolmentRequests,
          eq(enrolmentRequests.ipHash, ipHash),
          gte(enrolmentRequests.createdAt, since),
        ),
      )
      .get(),
  ]);
  return (a?.n ?? 0) + (b?.n ?? 0);
}

export async function insertEnquiry(ctx: OrgCtx, row: NewEnquiryRow & { id: string }) {
  const { ipHash: _ip, ...shown } = row;
  await writeWithAudit(ctx, [ctx.db.insert(enquiries).values(row)], {
    action: 'enquiry.received',
    entityType: 'enquiry',
    entityId: row.id,
    after: shown,
  });
}

export async function insertRequest(ctx: OrgCtx, row: NewRequestRow & { id: string }) {
  const { ipHash: _ip, ...shown } = row;
  await writeWithAudit(ctx, [ctx.db.insert(enrolmentRequests).values(row)], {
    action: 'enrolment_request.received',
    entityType: 'enrolment_request',
    entityId: row.id,
    after: shown,
  });
}

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listEnquiries(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  status: string | undefined,
  reach: Reach,
) {
  return ctx.db
    .select()
    .from(enquiries)
    .where(
      inOrg(
        ctx,
        enquiries,
        status ? eq(enquiries.status, status as EnquiryRow['status']) : undefined,
        branchWithin(enquiries.branchId, reach),
        beforeId ? lt(enquiries.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(enquiries.id))
    .limit(limit + 1);
}

export function findEnquiry(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(enquiries)
    .where(inOrg(ctx, enquiries, eq(enquiries.id, id), branchWithin(enquiries.branchId, reach)))
    .get();
}

export async function updateEnquiry(ctx: OrgCtx, before: EnquiryRow, status: EnquiryRow['status']) {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(enquiries)
        .set({ status })
        .where(inOrg(ctx, enquiries, eq(enquiries.id, before.id)))
        .returning(),
    ],
    {
      action: 'enquiry.updated',
      entityType: 'enquiry',
      entityId: before.id,
      ...changedFields(before, { status }),
    },
  );
  return (updated as EnquiryRow[])[0];
}

export function listRequests(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  status: string | undefined,
  reach: Reach,
) {
  return ctx.db
    .select()
    .from(enrolmentRequests)
    .where(
      inOrg(
        ctx,
        enrolmentRequests,
        status ? eq(enrolmentRequests.status, status as RequestRow['status']) : undefined,
        branchWithin(enrolmentRequests.branchId, reach),
        beforeId ? lt(enrolmentRequests.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(enrolmentRequests.id))
    .limit(limit + 1);
}

export function findRequest(ctx: OrgCtx, id: string, reach: Reach) {
  return ctx.db
    .select()
    .from(enrolmentRequests)
    .where(
      inOrg(
        ctx,
        enrolmentRequests,
        eq(enrolmentRequests.id, id),
        branchWithin(enrolmentRequests.branchId, reach),
      ),
    )
    .get();
}

/**
 * Records the decision, only while the request is still pending, so two staff deciding at once
 * can't both. Returns the request as decided, or undefined when it was decided already.
 */
export async function decideRequest(
  ctx: OrgCtx,
  before: RequestRow,
  decision: Pick<RequestRow, 'status' | 'reason' | 'result'>,
) {
  const change = {
    ...decision,
    decidedByUserId: ctx.actorUserId,
    decidedAt: new Date().toISOString(),
  };
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(enrolmentRequests)
        .set(change)
        .where(
          and(
            inOrg(ctx, enrolmentRequests, eq(enrolmentRequests.id, before.id)),
            eq(enrolmentRequests.status, 'pending'),
          ),
        )
        .returning(),
    ],
    {
      action: `enrolment_request.${decision.status}`,
      entityType: 'enrolment_request',
      entityId: before.id,
      ...changedFields(before, decision),
    },
  );
  return (updated as RequestRow[])[0];
}

/** How many requests are waiting, for the dashboard. */
export async function countPending(ctx: OrgCtx, reach: Reach) {
  const row = await ctx.db
    .select({ n: count() })
    .from(enrolmentRequests)
    .where(
      inOrg(
        ctx,
        enrolmentRequests,
        eq(enrolmentRequests.status, 'pending'),
        branchWithin(enrolmentRequests.branchId, reach),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** Clears what the public form sent for the enrolment requests approved into the family (TUI-79). */
export function eraseStatements(ctx: OrgCtx, familyId: string): BatchItem<'sqlite'>[] {
  return [
    ctx.db
      .update(enrolmentRequests)
      .set({ guardian: {}, students: [], notes: null, ipHash: null })
      .where(
        and(
          eq(enrolmentRequests.orgId, ctx.orgId),
          sql`json_extract(${enrolmentRequests.result}, '$.familyId') = ${familyId}`,
        ),
      ),
  ];
}
