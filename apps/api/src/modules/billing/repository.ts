import { invoiceLines, invoices, now, priceRules, taxRates } from '@edustrux/db';
import { basesOverlap, PRICE_BASES, type InvoiceStatus, type PriceBasis } from '@edustrux/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inIds, inOrg, writeWithAudit, type AuditEntry, type OrgCtx } from '../../db/scope';

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

export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type NewInvoiceLineRow = typeof invoiceLines.$inferInsert;
export type InvoiceChanges = Partial<Pick<NewInvoiceRow, 'dueDate' | 'notes'>>;
export type InvoiceFilter = {
  familyId?: string;
  /** Only these families' invoices: a home-branch filter. */
  familyIds?: string[];
  termId?: string;
  month?: string;
  status?: InvoiceStatus;
};
/**
 * The part of the org's invoices a caller may see: every one when empty, else those of the
 * families in `familyIds`. `issuedOnly` leaves out the ones that were never issued, which is
 * all a parent sees.
 */
export type InvoiceReach = { familyIds?: string[]; issuedOnly?: boolean };

// D1 binds at most 100 values per statement. An invoice row has 21 columns and a line 30.
const INVOICES_PER_INSERT = 4;
const LINES_PER_INSERT = 3;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

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

/** Every tax rate in the org, for taxing many prices in one go. */
export function allTaxRates(ctx: OrgCtx) {
  return ctx.db.select().from(taxRates).where(inOrg(ctx, taxRates));
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

// ── Invoices ────────────────────────────────────────────────────────────────

const invoiceFilter = (filter: InvoiceFilter) => [
  filter.familyId ? eq(invoices.familyId, filter.familyId) : undefined,
  filter.familyIds ? inIds(invoices.familyId, filter.familyIds) : undefined,
  filter.termId ? eq(invoices.termId, filter.termId) : undefined,
  filter.month ? eq(invoices.month, filter.month) : undefined,
  filter.status ? eq(invoices.status, filter.status) : undefined,
];

const withinInvoiceReach = (reach: InvoiceReach) =>
  and(
    reach.familyIds ? inIds(invoices.familyId, reach.familyIds) : undefined,
    reach.issuedOnly ? isNotNull(invoices.issuedAt) : undefined,
  );

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listInvoices(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: InvoiceFilter,
  reach: InvoiceReach,
) {
  return ctx.db
    .select()
    .from(invoices)
    .where(
      inOrg(
        ctx,
        invoices,
        ...invoiceFilter(filter),
        withinInvoiceReach(reach),
        beforeId ? lt(invoices.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(invoices.id))
    .limit(limit + 1);
}

export function findInvoice(ctx: OrgCtx, id: string, reach: InvoiceReach) {
  return ctx.db
    .select()
    .from(invoices)
    .where(inOrg(ctx, invoices, eq(invoices.id, id), withinInvoiceReach(reach)))
    .get();
}

/** The lines of the given invoices, each invoice's oldest enrolment first. */
export function listLines(ctx: OrgCtx, invoiceIds: string[]) {
  return ctx.db
    .select()
    .from(invoiceLines)
    .where(inOrg(ctx, invoiceLines, inIds(invoiceLines.invoiceId, invoiceIds)))
    .orderBy(asc(invoiceLines.enrolmentId), asc(invoiceLines.id));
}

/**
 * What these enrolments have been invoiced for so far, for any period: their lines on invoices
 * that aren't void, each with the job that generated its invoice.
 */
export function linesInvoiced(ctx: OrgCtx, enrolmentIds: string[]) {
  return ctx.db
    .select({
      enrolmentId: invoiceLines.enrolmentId,
      periodKey: invoiceLines.periodKey,
      periodStart: invoiceLines.periodStart,
      periodEnd: invoiceLines.periodEnd,
      basis: invoiceLines.basis,
      lessons: invoiceLines.lessons,
      jobId: invoices.jobId,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      inOrg(
        ctx,
        invoiceLines,
        inIds(invoiceLines.enrolmentId, enrolmentIds),
        isNull(invoiceLines.voidedAt),
      ),
    );
}

/**
 * Writes one run's invoices and their lines as one batch with one audit row: all of them or
 * none. The unique index on a line's enrolment and period fails the whole batch if another run
 * billed one of the enrolments in the meantime.
 */
export async function insertInvoices(
  ctx: OrgCtx,
  rows: (NewInvoiceRow & { id: string })[],
  lines: (NewInvoiceLineRow & { id: string })[],
  audit: AuditEntry,
) {
  await writeWithAudit(
    ctx,
    [
      ...chunks(rows, INVOICES_PER_INSERT).map((chunk) => ctx.db.insert(invoices).values(chunk)),
      ...chunks(lines, LINES_PER_INSERT).map((chunk) => ctx.db.insert(invoiceLines).values(chunk)),
    ],
    audit,
  );
}

/** What a job has generated, whatever became of the invoices since. */
export async function generatedBy(ctx: OrgCtx, jobId: string) {
  const ofJob = inOrg(ctx, invoices, eq(invoices.jobId, jobId));
  const [made, lines] = await Promise.all([
    ctx.db
      .select({ n: count(), total: sum(invoices.totalAmount).mapWith(Number) })
      .from(invoices)
      .where(ofJob)
      .get(),
    ctx.db
      .select({ n: count() })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(inOrg(ctx, invoiceLines), ofJob))
      .get(),
  ]);
  return { invoices: made?.n ?? 0, lines: lines?.n ?? 0, total: made?.total ?? 0 };
}

export async function updateInvoice(ctx: OrgCtx, before: InvoiceRow, changes: InvoiceChanges) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(changes)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id))),
    ],
    {
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: before.id,
      before,
      after: changes,
    },
  );
}

/** Draft to issued. The status in the `where` keeps two requests at once from both issuing. */
export async function issueInvoice(ctx: OrgCtx, before: InvoiceRow) {
  const after = { status: 'issued' as const, issuedAt: now() };
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(after)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id), eq(invoices.status, 'draft'))),
    ],
    { action: 'invoice.issued', entityType: 'invoice', entityId: before.id, before, after },
  );
}

/**
 * Voids the invoice and marks its lines, which frees their enrolments to be invoiced for the
 * period again.
 */
export async function voidInvoice(ctx: OrgCtx, before: InvoiceRow) {
  const after = { status: 'void' as const, voidedAt: now() };
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(after)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id))),
      ctx.db
        .update(invoiceLines)
        .set({ voidedAt: after.voidedAt })
        .where(inOrg(ctx, invoiceLines, eq(invoiceLines.invoiceId, before.id))),
    ],
    { action: 'invoice.voided', entityType: 'invoice', entityId: before.id, before, after },
  );
}
