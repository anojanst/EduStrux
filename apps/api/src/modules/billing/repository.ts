import {
  discountRules,
  invoiceLines,
  invoices,
  now,
  paymentAllocations,
  payments,
  priceRules,
  taxRates,
} from '@edustrux/db';
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
  changedFields,
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

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
export type AllocationRow = typeof paymentAllocations.$inferSelect;
export type NewAllocationRow = typeof paymentAllocations.$inferInsert;
export type PaymentFilter = { familyId?: string; invoiceId?: string };
/** A payment goes with its family, as an invoice does: every one when empty, else `familyIds`'. */
export type PaymentReach = { familyIds?: Ids };

// D1 binds at most 100 values per statement. An invoice row has 21 columns and a line 30.
const INVOICES_PER_INSERT = 4;
const LINES_PER_INSERT = 3;
// An allocation binds 7.
const ALLOCATIONS_PER_INSERT = 12;

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

/** Returns the tax rate as stored, from the same batch, so the caller doesn't read it back. */
export async function insertTaxRate(
  ctx: OrgCtx,
  rate: NewTaxRateRow & { id: string },
): Promise<TaxRateRow> {
  const results = await writeWithAudit(
    ctx,
    [
      ...(rate.isDefault ? [clearDefault(ctx)] : []),
      ctx.db.insert(taxRates).values(rate).returning(),
    ],
    { action: 'tax_rate.created', entityType: 'tax_rate', entityId: rate.id, after: rate },
  );
  // The insert is the last statement of the batch.
  const row = (results.at(-1) as TaxRateRow[])[0];
  if (!row) throw new Error('Tax rate missing after insert');
  return row;
}

/** Returns the tax rate as updated, from the same batch. undefined if it was just deleted. */
export async function updateTaxRate(
  ctx: OrgCtx,
  before: TaxRateRow,
  changes: TaxRateChanges,
): Promise<TaxRateRow | undefined> {
  const results = await writeWithAudit(
    ctx,
    [
      ...(changes.isDefault && !before.isDefault ? [clearDefault(ctx)] : []),
      ctx.db
        .update(taxRates)
        .set(changes)
        .where(inOrg(ctx, taxRates, eq(taxRates.id, before.id)))
        .returning(),
    ],
    {
      action: 'tax_rate.updated',
      entityType: 'tax_rate',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  // The update is the last statement of the batch.
  return (results.at(-1) as TaxRateRow[])[0];
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

/** Returns the rule as stored, from the same batch, so the caller doesn't read it back. */
export async function insertPriceRule(
  ctx: OrgCtx,
  rule: NewPriceRuleRow & { id: string },
): Promise<PriceRuleRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(priceRules).values(rule).returning()],
    { action: 'price_rule.created', entityType: 'price_rule', entityId: rule.id, after: rule },
  );
  const row = (inserted as PriceRuleRow[])[0];
  if (!row) throw new Error('Price rule missing after insert');
  return row;
}

/** Returns the rule as updated, from the same batch. undefined if it was just deleted. */
export async function updatePriceRule(
  ctx: OrgCtx,
  before: PriceRuleRow,
  changes: PriceRuleChanges,
): Promise<PriceRuleRow | undefined> {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(priceRules)
        .set(changes)
        .where(inOrg(ctx, priceRules, eq(priceRules.id, before.id)))
        .returning(),
    ],
    {
      action: 'price_rule.updated',
      entityType: 'price_rule',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as PriceRuleRow[])[0];
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
const fewFamilies = (reach: InvoiceReach | PaymentReach) =>
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

/** The invoices with these ids that are within reach, for a payment to pay towards. */
export function findInvoices(ctx: OrgCtx, ids: string[], reach: InvoiceReach) {
  return ctx.db
    .select()
    .from(invoices)
    .where(inOrg(ctx, invoices, inIds(invoices.id, ids), ...withinInvoiceReach(reach)));
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
 * An enrolment's lines on invoices that aren't void, each with its invoice's status, totals and
 * how many lines it has, oldest first.
 */
export function linesOfEnrolment(ctx: OrgCtx, enrolmentId: string) {
  const others = sql<number>`(select count(*) from ${invoiceLines} as l where l.org_id = ${ctx.orgId} and l.invoice_id = ${invoices.id} and l.deleted_at is null)`;
  return ctx.db
    .select({
      line: invoiceLines,
      invoice: {
        id: invoices.id,
        status: invoices.status,
        currency: invoices.currency,
        lines: others,
      },
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        inOrg(
          ctx,
          invoiceLines,
          eq(invoiceLines.enrolmentId, enrolmentId),
          isNull(invoiceLines.voidedAt),
        ),
        inOrg(ctx, invoices),
      ),
    )
    .orderBy(asc(invoiceLines.id));
}

/** A line's new charge: the columns `chargeAgain` works out. */
export type LineCharge = {
  quantity: number;
  lessons: number;
  freeLessons: number;
  discountAmount: number;
  discounts: { ruleId: string; name: string; amount: number }[] | null;
  subtotal: number;
  tax: number;
  total: number;
};

/**
 * Statements that charge a draft's line again, or take it off the draft when `charge` is null,
 * and move the draft's totals by the difference. A draft left with no lines is voided. Each
 * statement holds only while the invoice is still a draft, so one issued since it was read keeps
 * its lines.
 */
export function rechargeDraftLine(
  ctx: OrgCtx,
  line: InvoiceLineRow,
  charge: LineCharge | null,
  emptied: boolean,
) {
  const stillDraft = inIds(
    invoiceLines.invoiceId,
    idsFrom(
      ctx,
      invoices,
      invoices.id,
      eq(invoices.id, line.invoiceId),
      eq(invoices.status, 'draft'),
    ),
  );
  const lineChange = charge
    ? {
        quantity: charge.quantity,
        lessons: charge.lessons,
        freeLessons: charge.freeLessons,
        discountAmount: charge.discountAmount,
        discounts: charge.discounts,
        subtotalAmount: charge.subtotal,
        taxAmount: charge.tax,
        totalAmount: charge.total,
      }
    : { deletedAt: now() };
  const delta = (before: number, after: number) => after - before;
  const draft = and(eq(invoices.id, line.invoiceId), eq(invoices.status, 'draft'));
  return [
    ctx.db
      .update(invoiceLines)
      .set(lineChange)
      .where(and(inOrg(ctx, invoiceLines, eq(invoiceLines.id, line.id)), stillDraft)),
    ctx.db
      .update(invoices)
      .set({
        subtotalAmount: sql`${invoices.subtotalAmount} + ${delta(line.subtotalAmount, charge?.subtotal ?? 0)}`,
        taxAmount: sql`${invoices.taxAmount} + ${delta(line.taxAmount, charge?.tax ?? 0)}`,
        totalAmount: sql`${invoices.totalAmount} + ${delta(line.totalAmount, charge?.total ?? 0)}`,
        ...(emptied ? { status: 'void' as const, voidedAt: now() } : {}),
      })
      .where(inOrg(ctx, invoices, draft)),
  ];
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

/** How many invoices a job generated, and what they come to. */
export function invoicesGeneratedBy(ctx: OrgCtx, jobId: string) {
  return ctx.db
    .select({ n: count(), total: sum(invoices.totalAmount).mapWith(Number) })
    .from(invoices)
    .where(inOrg(ctx, invoices, eq(invoices.jobId, jobId)))
    .get();
}

/**
 * How many lines are on the invoices a job generated. The lines are reached through those
 * invoices' ids, so it reads the job's own lines and not every line the org has.
 */
export function linesGeneratedBy(ctx: OrgCtx, jobId: string) {
  const ofJob = idsFrom(ctx, invoices, invoices.id, eq(invoices.jobId, jobId));
  return ctx.db
    .select({ n: count() })
    .from(invoiceLines)
    .where(inOrg(ctx, invoiceLines, inIds(invoiceLines.invoiceId, ofJob)))
    .get();
}

/** What a job has generated, whatever became of the invoices since. */
export async function generatedBy(ctx: OrgCtx, jobId: string) {
  const [made, lines] = await Promise.all([
    invoicesGeneratedBy(ctx, jobId),
    linesGeneratedBy(ctx, jobId),
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
      ...changedFields(before, changes),
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
    {
      action: 'invoice.issued',
      entityType: 'invoice',
      entityId: before.id,
      ...changedFields(before, after),
    },
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
  // Only a draft or an issued one: a payment recorded since the read leaves it as it is. Its
  // lines are voided only if this statement voided it, so a paid invoice keeps its enrolments
  // billed. Returns undefined when it changed nothing.
  const voidedNow = idsFrom(
    ctx,
    invoices,
    invoices.id,
    eq(invoices.id, before.id),
    eq(invoices.voidedAt, after.voidedAt),
  );
  const [, voided] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(invoices)
        .set(after)
        .where(
          inOrg(
            ctx,
            invoices,
            eq(invoices.id, before.id),
            inArray(invoices.status, ['draft', 'issued']),
          ),
        )
        .returning(),
      ctx.db
        .update(invoiceLines)
        .set({ voidedAt: after.voidedAt })
        .where(inOrg(ctx, invoiceLines, inIds(invoiceLines.invoiceId, voidedNow))),
    ],
    {
      action: 'invoice.voided',
      entityType: 'invoice',
      entityId: before.id,
      ...changedFields(before, after),
    },
  );
  return (voided as InvoiceRow[])[0];
}

// ── Payments ────────────────────────────────────────────────────────────────

/**
 * The list's filters. A payment towards an invoice is found from the invoice's allocations, a
 * handful of rows, so that filter comes first and the page goes to those payments. The family is
 * the next way in. With a caller who reaches a few families, the page is read from those.
 */
const paymentFilter = (ctx: OrgCtx, filter: PaymentFilter) => [
  filter.invoiceId
    ? inIds(
        payments.id,
        idsFrom(
          ctx,
          paymentAllocations,
          paymentAllocations.paymentId,
          eq(paymentAllocations.invoiceId, filter.invoiceId),
        ),
      )
    : undefined,
  filter.familyId ? eq(payments.familyId, filter.familyId) : undefined,
];

/** Spread into `inOrg`: a parent's families are ids it goes to; a branch's are checked per row. */
const withinPaymentReach = (reach: PaymentReach) =>
  reach.familyIds ? inIds(payments.familyId, reach.familyIds) : undefined;

const onPaymentPage = (
  ctx: OrgCtx,
  filter: PaymentFilter,
  reach: PaymentReach,
  beforeId: string | undefined,
): (SQL | undefined)[] => [
  ...paymentFilter(ctx, filter),
  withinPaymentReach(reach),
  beforeId ? lt(payments.id, beforeId) : undefined,
];

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listPayments(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: PaymentFilter,
  reach: PaymentReach,
) {
  return ctx.db
    .select()
    .from(payments)
    .where(inOrg(ctx, payments, ...onPaymentPage(ctx, filter, reach, beforeId)))
    .orderBy(desc(payments.id))
    .limit(limit + 1);
}

/** A column of the `limit` payments a page shows, as a query, to read what it shows beside it. */
const ofPaymentPage = (
  ctx: OrgCtx,
  column: SQLiteColumn,
  limit: number,
  beforeId: string | undefined,
  filter: PaymentFilter,
  reach: PaymentReach,
) =>
  firstIds(
    idsFrom(ctx, payments, column, ...onPaymentPage(ctx, filter, reach, beforeId)),
    limit,
    desc(payments.id),
  );

/** The payments one page of the list shows. */
export function paymentsOnPage(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: PaymentFilter,
  reach: PaymentReach,
): IdQuery {
  return ofPaymentPage(ctx, payments.id, limit, beforeId, filter, reach);
}

/** The families of the payments one page of the list shows. */
export function familiesOfPaymentPage(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: PaymentFilter,
  reach: PaymentReach,
): IdQuery {
  return ofPaymentPage(ctx, payments.familyId, limit, beforeId, filter, reach);
}

/** One page of payments and their allocations, read in one batch: one trip and one moment. */
export async function listPaymentsWithAllocations(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: PaymentFilter,
  reach: PaymentReach,
) {
  const [rows, allocations] = await ctx.db.batch([
    listPayments(ctx, limit, beforeId, filter, reach),
    listAllocations(ctx, paymentsOnPage(ctx, limit, beforeId, filter, reach)),
  ]);
  return { rows, allocations };
}

export function findPayment(ctx: OrgCtx, id: string, reach: PaymentReach) {
  return ctx.db
    .select()
    .from(payments)
    .where(inOrg(ctx, payments, eq(payments.id, id), withinPaymentReach(reach)))
    .get();
}

/** One payment, if it is within reach, as a query: its allocations are read beside it. */
export function paymentWithin(ctx: OrgCtx, id: string, reach: PaymentReach): IdQuery {
  return idsFrom(ctx, payments, payments.id, eq(payments.id, id), withinPaymentReach(reach));
}

/** The allocations of the given payments, each payment's oldest invoice first. */
export function listAllocations(ctx: OrgCtx, paymentIds: Ids) {
  return ctx.db
    .select()
    .from(paymentAllocations)
    .where(inOrg(ctx, paymentAllocations, inIds(paymentAllocations.paymentId, paymentIds)))
    .orderBy(asc(paymentAllocations.paymentId), asc(paymentAllocations.invoiceId));
}

/**
 * Sets each invoice's paid amount to the sum of its allocations that aren't deleted, and its
 * status to match: nothing paid is `issued`, some is `part_paid`, all of it is `paid`. Worked
 * out from the allocations in the same batch that changes them, so two payments at once leave
 * it right.
 */
export function settleInvoices(ctx: OrgCtx, invoiceIds: string[]) {
  const paid = sql`(select coalesce(sum(${paymentAllocations.amount}), 0) from ${paymentAllocations} where ${paymentAllocations.orgId} = ${invoices.orgId} and ${paymentAllocations.invoiceId} = ${invoices.id} and ${paymentAllocations.deletedAt} is null)`;
  return ctx.db
    .update(invoices)
    .set({
      paidAmount: paid,
      status: sql`case when ${paid} = 0 then 'issued' when ${paid} < ${invoices.totalAmount} then 'part_paid' else 'paid' end`,
    })
    .where(inOrg(ctx, invoices, inIds(invoices.id, invoiceIds)));
}

/**
 * Writes the payment, its allocations and the invoices they pay towards as one batch with one
 * audit row. Returns the payment and the allocations as stored. The trigger of migration 0016
 * fails the whole batch if an invoice has stopped taking the payment since it was read: see
 * `allocationRejected`.
 */
export async function insertPayment(
  ctx: OrgCtx,
  payment: NewPaymentRow & { id: string },
  allocations: (NewAllocationRow & { id: string })[],
) {
  const [, inserted, ...rest] = await writeWithAudit(
    ctx,
    [
      ctx.db.insert(payments).values(payment).returning(),
      ...chunks(allocations, ALLOCATIONS_PER_INSERT).map((chunk) =>
        ctx.db.insert(paymentAllocations).values(chunk).returning(),
      ),
      settleInvoices(
        ctx,
        allocations.map((a) => a.invoiceId),
      ),
    ],
    {
      action: 'payment.created',
      entityType: 'payment',
      entityId: payment.id,
      after: {
        ...payment,
        allocations: allocations.map(({ invoiceId, amount }) => ({ invoiceId, amount })),
      },
    },
  );
  const row = (inserted as PaymentRow[])[0];
  if (!row) throw new Error('Payment missing after insert');
  // The allocation inserts come before the invoices' update, the last statement.
  const stored = rest.slice(0, -1).flat() as AllocationRow[];
  return { payment: row, allocations: stored };
}

/** Whether a write failed on the allocation trigger of migration 0016. */
export function allocationRejected(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e.message.includes('payment_allocation_rejected')) return true;
  }
  return false;
}

/**
 * Deletes the payment and its allocations, and settles the invoices they paid towards again,
 * in one batch with one audit row.
 */
export async function softDeletePayment(
  ctx: OrgCtx,
  before: PaymentRow,
  allocations: AllocationRow[],
) {
  const deletedAt = now();
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(payments)
        .set({ deletedAt })
        .where(inOrg(ctx, payments, eq(payments.id, before.id))),
      ctx.db
        .update(paymentAllocations)
        .set({ deletedAt })
        .where(inOrg(ctx, paymentAllocations, eq(paymentAllocations.paymentId, before.id))),
      ...(allocations.length > 0
        ? [
            settleInvoices(
              ctx,
              allocations.map((a) => a.invoiceId),
            ),
          ]
        : []),
    ],
    {
      action: 'payment.deleted',
      entityType: 'payment',
      entityId: before.id,
      before: {
        ...before,
        allocations: allocations.map(({ invoiceId, amount }) => ({ invoiceId, amount })),
      },
    },
  );
}

// ── Discount rules (TUI-58) ─────────────────────────────────────────────────

export type DiscountRuleRow = typeof discountRules.$inferSelect;
export type NewDiscountRuleRow = typeof discountRules.$inferInsert;

/** Every rule of the org, for an invoice run. */
export function allDiscountRules(ctx: OrgCtx) {
  return ctx.db.select().from(discountRules).where(inOrg(ctx, discountRules));
}

/** Oldest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listDiscountRules(
  ctx: OrgCtx,
  limit: number,
  afterId: string | undefined,
  kind: string | undefined,
) {
  return ctx.db
    .select()
    .from(discountRules)
    .where(
      inOrg(
        ctx,
        discountRules,
        kind ? eq(discountRules.kind, kind as DiscountRuleRow['kind']) : undefined,
        afterId ? gt(discountRules.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(discountRules.id))
    .limit(limit + 1);
}

export function findDiscountRule(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(discountRules)
    .where(inOrg(ctx, discountRules, eq(discountRules.id, id)))
    .get();
}

export async function insertDiscountRule(ctx: OrgCtx, row: NewDiscountRuleRow & { id: string }) {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(discountRules).values(row).returning()],
    { action: 'discount_rule.created', entityType: 'discount_rule', entityId: row.id, after: row },
  );
  return (inserted as DiscountRuleRow[])[0]!;
}

export async function updateDiscountRule(
  ctx: OrgCtx,
  before: DiscountRuleRow,
  changes: Partial<NewDiscountRuleRow>,
) {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(discountRules)
        .set(changes)
        .where(inOrg(ctx, discountRules, eq(discountRules.id, before.id)))
        .returning(),
    ],
    {
      action: 'discount_rule.updated',
      entityType: 'discount_rule',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as DiscountRuleRow[])[0];
}

export async function softDeleteDiscountRule(ctx: OrgCtx, before: DiscountRuleRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(discountRules)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, discountRules, eq(discountRules.id, before.id))),
    ],
    { action: 'discount_rule.deleted', entityType: 'discount_rule', entityId: before.id, before },
  );
}
