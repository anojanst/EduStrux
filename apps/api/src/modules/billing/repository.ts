import { now, priceRules, taxRates } from '@edustrux/db';
import { basesOverlap, PRICE_BASES, type PriceBasis } from '@edustrux/shared';
import { asc, count, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inIds, inOrg, writeWithAudit, type OrgCtx } from '../../db/scope';

export type TaxRateRow = typeof taxRates.$inferSelect;
export type NewTaxRateRow = typeof taxRates.$inferInsert;
export type TaxRateChanges = Partial<
  Pick<NewTaxRateRow, 'name' | 'rateBps' | 'inclusive' | 'isDefault'>
>;

export type PriceRuleRow = typeof priceRules.$inferSelect;
export type NewPriceRuleRow = typeof priceRules.$inferInsert;
export type PriceRuleChanges = Partial<
  Pick<
    NewPriceRuleRow,
    'priceAmount' | 'priceCurrency' | 'packLessons' | 'freeTrialLessons' | 'taxRateId'
  >
>;
/** What a rule prices: one class, one course, or (both null) every class in the org. */
export type PriceRuleTarget = { classId: string | null; courseId: string | null };
export type PriceRuleFilter = { classId?: string; courseId?: string; taxRateId?: string };
/** Branch staff reach every rule but the ones for other branches' classes. */
export type PriceRuleReach = { branchIds?: string[] };

// ── Tax rates ───────────────────────────────────────────────────────────────

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

/** The org's default tax rate, if it has one. */
export function findDefaultTaxRate(ctx: OrgCtx) {
  return ctx.db
    .select()
    .from(taxRates)
    .where(inOrg(ctx, taxRates, eq(taxRates.isDefault, true)))
    .get();
}

/** Takes the default flag off whichever rate has it, so another can take it in the same batch. */
const clearDefault = (ctx: OrgCtx) =>
  ctx.db
    .update(taxRates)
    .set({ isDefault: false })
    .where(inOrg(ctx, taxRates, eq(taxRates.isDefault, true)));

export async function insertTaxRate(ctx: OrgCtx, rate: NewTaxRateRow & { id: string }) {
  await writeWithAudit(
    ctx,
    [...(rate.isDefault ? [clearDefault(ctx)] : []), ctx.db.insert(taxRates).values(rate)],
    { action: 'tax_rate.created', entityType: 'tax_rate', entityId: rate.id, after: rate },
  );
}

export async function updateTaxRate(ctx: OrgCtx, before: TaxRateRow, changes: TaxRateChanges) {
  await writeWithAudit(
    ctx,
    [
      ...(changes.isDefault && !before.isDefault ? [clearDefault(ctx)] : []),
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

// ── Price rules ─────────────────────────────────────────────────────────────

const priceRuleFilter = (filter: PriceRuleFilter) => [
  filter.classId ? eq(priceRules.classId, filter.classId) : undefined,
  filter.courseId ? eq(priceRules.courseId, filter.courseId) : undefined,
  filter.taxRateId ? eq(priceRules.taxRateId, filter.taxRateId) : undefined,
];

/** A rule for a class is in that class's branch; every other rule has no branch. */
const withinReach = (reach: PriceRuleReach) =>
  reach.branchIds
    ? or(isNull(priceRules.branchId), inIds(priceRules.branchId, reach.branchIds))
    : undefined;

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listPriceRules(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  filter: PriceRuleFilter,
  reach: PriceRuleReach,
) {
  return ctx.db
    .select()
    .from(priceRules)
    .where(
      inOrg(
        ctx,
        priceRules,
        ...priceRuleFilter(filter),
        withinReach(reach),
        afterId ? gt(priceRules.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(priceRules.id))
    .limit(limit + 1);
}

export function findPriceRule(ctx: OrgCtx, id: string, reach: PriceRuleReach) {
  return ctx.db
    .select()
    .from(priceRules)
    .where(inOrg(ctx, priceRules, eq(priceRules.id, id), withinReach(reach)))
    .get();
}

/** Every price rule in the org, for pricing many enrolments in one go. */
export function allPriceRules(ctx: OrgCtx) {
  return ctx.db.select().from(priceRules).where(inOrg(ctx, priceRules)).orderBy(asc(priceRules.id));
}

/** How many price rules a class, a course or a tax rate has. None can be deleted while any do. */
export async function countPriceRules(ctx: OrgCtx, filter: PriceRuleFilter) {
  const row = await ctx.db
    .select({ n: count() })
    .from(priceRules)
    .where(inOrg(ctx, priceRules, ...priceRuleFilter(filter)))
    .get();
  return row?.n ?? 0;
}

/** Whether the target already has a rule that some class could also be priced by. */
export async function priceRuleTaken(ctx: OrgCtx, target: PriceRuleTarget, basis: PriceBasis) {
  const same = (column: SQLiteColumn, id: string | null) =>
    id === null ? isNull(column) : eq(column, id);
  const row = await ctx.db
    .select({ id: priceRules.id })
    .from(priceRules)
    .where(
      inOrg(
        ctx,
        priceRules,
        same(priceRules.classId, target.classId),
        same(priceRules.courseId, target.courseId),
        inArray(
          priceRules.basis,
          PRICE_BASES.filter((other) => basesOverlap(basis, other)),
        ),
      ),
    )
    .get();
  return row !== undefined;
}

export async function insertPriceRule(ctx: OrgCtx, rule: NewPriceRuleRow & { id: string }) {
  await writeWithAudit(ctx, [ctx.db.insert(priceRules).values(rule)], {
    action: 'price_rule.created',
    entityType: 'price_rule',
    entityId: rule.id,
    after: rule,
  });
}

export async function updatePriceRule(
  ctx: OrgCtx,
  before: PriceRuleRow,
  changes: PriceRuleChanges,
) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(priceRules)
        .set(changes)
        .where(inOrg(ctx, priceRules, eq(priceRules.id, before.id))),
    ],
    {
      action: 'price_rule.updated',
      entityType: 'price_rule',
      entityId: before.id,
      before,
      after: changes,
    },
  );
}

export async function softDeletePriceRule(ctx: OrgCtx, before: PriceRuleRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(priceRules)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, priceRules, eq(priceRules.id, before.id))),
    ],
    { action: 'price_rule.deleted', entityType: 'price_rule', entityId: before.id, before },
  );
}
