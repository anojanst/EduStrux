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
  type SQL,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  firstIds,
  idsFrom,
  inIds,
  inOrg,
  writeWithAudit,
  type AuditEntry,
  type IdQuery,
  type Ids,
  type OrgCtx,
} from '../../db/scope';

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
  familyIds?: Ids;
  termId?: string;
  month?: string;
  status?: InvoiceStatus;
};
/**
 * The part of the org's invoices a caller may see: every one when empty, else those of the
 * families in `familyIds`. `issuedOnly` leaves out the ones that were never issued, which is
 * all a parent sees.
 */
export type InvoiceReach = { familyIds?: Ids; issuedOnly?: boolean };

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

/** Whether the reach is a few families, which a statement goes to: a parent's, not a branch's. */
const fewFamilies = (reach: InvoiceReach) =>
  reach.familyIds !== undefined && (Array.isArray(reach.familyIds) || !reach.familyIds.wide);

/**
 * The list's filters. The page of a caller who reaches a few families is read from those
 * families, so there the term, month and status only narrow it: the `+` keeps SQLite from
 * reading everything the org has in that term or with that status to find the page.
 */
const invoiceFilter = (filter: InvoiceFilter, reach: InvoiceReach) => {
  const is = (column: SQLiteColumn, value: string) =>
    fewFamilies(reach) ? sql`+${column} = ${value}` : eq(column, value);
  return [
    filter.familyId ? eq(invoices.familyId, filter.familyId) : undefined,
    filter.familyIds ? inIds(invoices.familyId, filter.familyIds) : undefined,
    filter.termId ? is(invoices.termId, filter.termId) : undefined,
    filter.month ? is(invoices.month, filter.month) : undefined,
    filter.status ? is(invoices.status, filter.status) : undefined,
  ];
};

/**
 * Spread into `inOrg`, so a parent's families are ids the query goes straight to. The families
 * of branch staff are `wide`: the page is read in its own order and each invoice checked.
 */
const withinInvoiceReach = (reach: InvoiceReach) => [
  reach.familyIds ? inIds(invoices.familyId, reach.familyIds) : undefined,
  reach.issuedOnly ? isNotNull(invoices.issuedAt) : undefined,
];

/** What finds one page of the list: the filters, the caller's reach and the cursor. */
const onPage = (
  filter: InvoiceFilter,
  reach: InvoiceReach,
  beforeId: string | undefined,
): (SQL | undefined)[] => [
  ...invoiceFilter(filter, reach),
  ...withinInvoiceReach(reach),
  beforeId ? lt(invoices.id, beforeId) : undefined,
];

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
    .where(inOrg(ctx, invoices, ...onPage(filter, reach, beforeId)))
    .orderBy(desc(invoices.id))
    .limit(limit + 1);
}

/**
 * A column of the `limit` invoices that page shows, as a query: what the page shows of other
 * tables is read beside it, in the same stage (D-104).
 */
const ofPage = (
  ctx: OrgCtx,
  column: SQLiteColumn,
  limit: number,
  beforeId: string | undefined,
  filter: InvoiceFilter,
  reach: InvoiceReach,
) =>
  firstIds(
    idsFrom(ctx, invoices, column, ...onPage(filter, reach, beforeId)),
    limit,
    desc(invoices.id),
  );

/** The invoices one page of the list shows. */
export function invoicesOnPage(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: InvoiceFilter,
  reach: InvoiceReach,
): IdQuery {
  return ofPage(ctx, invoices.id, limit, beforeId, filter, reach);
}

/** The families of the invoices one page of the list shows. */
export function familiesOnPage(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: InvoiceFilter,
  reach: InvoiceReach,
): IdQuery {
  return ofPage(ctx, invoices.familyId, limit, beforeId, filter, reach);
}

/**
 * One page of the list and the lines of the invoices on it, read in one batch. A batch is one
 * trip and one moment: an invoice added while the page is read can't push another off the page
 * the lines are read for, which would show that one with no lines.
 */
export async function listInvoicesWithLines(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: InvoiceFilter,
  reach: InvoiceReach,
) {
  const [rows, lines] = await ctx.db.batch([
    listInvoices(ctx, limit, beforeId, filter, reach),
    listLines(ctx, invoicesOnPage(ctx, limit, beforeId, filter, reach)),
  ]);
  return { rows, lines };
}

export function findInvoice(ctx: OrgCtx, id: string, reach: InvoiceReach) {
  return ctx.db
    .select()
    .from(invoices)
    .where(inOrg(ctx, invoices, eq(invoices.id, id), ...withinInvoiceReach(reach)))
    .get();
}

/**
 * One invoice, if it is within reach, as a query: its lines and what they show of other tables
 * are read beside it, in the same stage (D-104), and find nothing when it is outside the reach.
 */
export function invoiceWithin(ctx: OrgCtx, id: string, reach: InvoiceReach): IdQuery {
  return idsFrom(ctx, invoices, invoices.id, eq(invoices.id, id), ...withinInvoiceReach(reach));
}

/** The family of one invoice, if the invoice is within reach, as a query. */
export function familyOfInvoice(ctx: OrgCtx, id: string, reach: InvoiceReach): IdQuery {
  return idsFrom(
    ctx,
    invoices,
    invoices.familyId,
    eq(invoices.id, id),
    ...withinInvoiceReach(reach),
  );
}

/** The lines of the given invoices, each invoice's oldest enrolment first. */
export function listLines(ctx: OrgCtx, invoiceIds: Ids) {
  return ctx.db
    .select()
    .from(invoiceLines)
    .where(inOrg(ctx, invoiceLines, inIds(invoiceLines.invoiceId, invoiceIds)))
    .orderBy(asc(invoiceLines.enrolmentId), asc(invoiceLines.id));
}

/** The students on the lines of the given invoices, as a query, to read their names by. */
export function studentsOnLines(ctx: OrgCtx, invoiceIds: Ids): IdQuery {
  return idsFrom(
    ctx,
    invoiceLines,
    invoiceLines.studentId,
    inIds(invoiceLines.invoiceId, invoiceIds),
  );
}

/** The classes on the lines of the given invoices, as a query, to read their labels by. */
export function classesOnLines(ctx: OrgCtx, invoiceIds: Ids): IdQuery {
  return idsFrom(
    ctx,
    invoiceLines,
    invoiceLines.classId,
    inIds(invoiceLines.invoiceId, invoiceIds),
  );
}

/**
 * What these enrolments have been invoiced for so far, for any period: their lines on invoices
 * that aren't void, each with the job that generated its invoice.
 */
export function linesInvoiced(ctx: OrgCtx, enrolmentIds: Ids) {
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

/** Returns the invoice as updated, from the same batch, so the caller doesn't read it back. */
export async function updateInvoice(
  ctx: OrgCtx,
  before: InvoiceRow,
  changes: InvoiceChanges,
): Promise<InvoiceRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(changes)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id)))
        .returning(),
    ],
    {
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: before.id,
      before,
      after: changes,
    },
  );
  return (updated as InvoiceRow[])[0];
}

/**
 * Draft to issued. The status in the `where` keeps two requests at once from both issuing.
 * Returns the invoice as issued, from the same batch, or undefined when another request got
 * there first and this one changed nothing.
 */
export async function issueInvoice(
  ctx: OrgCtx,
  before: InvoiceRow,
): Promise<InvoiceRow | undefined> {
  const after = { status: 'issued' as const, issuedAt: now() };
  const [, issued] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(after)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id), eq(invoices.status, 'draft')))
        .returning(),
    ],
    { action: 'invoice.issued', entityType: 'invoice', entityId: before.id, before, after },
  );
  return (issued as InvoiceRow[])[0];
}

/**
 * Voids the invoice and marks its lines, which frees their enrolments to be invoiced for the
 * period again. Returns the invoice as voided, from the same batch.
 */
export async function voidInvoice(
  ctx: OrgCtx,
  before: InvoiceRow,
): Promise<InvoiceRow | undefined> {
  const after = { status: 'void' as const, voidedAt: now() };
  const [, voided] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(after)
        .where(inOrg(ctx, invoices, eq(invoices.id, before.id)))
        .returning(),
      ctx.db
        .update(invoiceLines)
        .set({ voidedAt: after.voidedAt })
        .where(inOrg(ctx, invoiceLines, eq(invoiceLines.invoiceId, before.id))),
    ],
    { action: 'invoice.voided', entityType: 'invoice', entityId: before.id, before, after },
  );
  return (voided as InvoiceRow[])[0];
}
