import { now, taxRates } from '@edustrux/db';
import { asc, eq, gt, ne, sql } from 'drizzle-orm';
import { inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type TaxRateRow = typeof taxRates.$inferSelect;
export type NewTaxRateRow = typeof taxRates.$inferInsert;
export type TaxRateChanges = Partial<Pick<NewTaxRateRow, 'name' | 'rateBps' | 'inclusive'>>;

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listTaxRates(ctx: OrgCtx, limit: number, afterId?: string) {
  return ctx.db
    .select()
    .from(taxRates)
    .where(inOrg(ctx, taxRates, afterId ? gt(taxRates.id, afterId) : undefined))
    .orderBy(asc(taxRates.id))
    .limit(limit + 1);
}

export function findTaxRate(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(taxRates)
    .where(inOrg(ctx, taxRates, eq(taxRates.id, id)))
    .get();
}

/** Case-insensitive, among the org's tax rates that aren't deleted. */
export async function taxRateNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ id: taxRates.id })
    .from(taxRates)
    .where(
      inOrg(
        ctx,
        taxRates,
        sql`lower(${taxRates.name}) = lower(${name})`,
        exceptId ? ne(taxRates.id, exceptId) : undefined,
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertTaxRate(ctx: OrgCtx, rate: NewTaxRateRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(taxRates).values(rate)], {
    action: 'tax_rate.created',
    entityType: 'tax_rate',
    entityId: rate.id,
    after: rate,
  });
}

export async function updateTaxRate(ctx: OrgCtx, before: TaxRateRow, changes: TaxRateChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(taxRates)
        .set(changes)
        .where(inOrg(ctx, taxRates, eq(taxRates.id, before.id))),
    ],
    {
      action: 'tax_rate.updated',
      entityType: 'tax_rate',
      entityId: before.id,
      before,
      after: changes,
    },
  );
}

export async function softDeleteTaxRate(ctx: OrgCtx, before: TaxRateRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(taxRates)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, taxRates, eq(taxRates.id, before.id))),
    ],
    { action: 'tax_rate.deleted', entityType: 'tax_rate', entityId: before.id, before },
  );
}
