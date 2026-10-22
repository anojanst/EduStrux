import {
  DISCOUNT_KINDS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PRICE_BASES,
  PRICE_SOURCES,
} from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { orgColumns } from '../columns';

// How classes are priced. A rule prices one class, one course's classes, or (course_id and
// class_id both null) every class in the org. The most specific one that fits a class wins.
export const priceRules = sqliteTable(
  'price_rules',
  {
    ...orgColumns(),
    courseId: text('course_id'),
    classId: text('class_id'),
    // Copied from the class, which keeps its branch for life, so what branch staff reach is a
    // filter on this table. null for a course's rule and an org-wide one.
    branchId: text('branch_id'),
    // per_term only fits a class in a term and per_month a class with no term.
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    // Minor units plus currency, for one `basis`.
    priceAmount: integer('price_amount').notNull(),
    priceCurrency: text('price_currency').notNull(),
    // Lessons in one pack. Set only when basis = 'pack'.
    packLessons: integer('pack_lessons'),
    // The first lessons of an enrolment that aren't charged.
    freeTrialLessons: integer('free_trial_lessons').notNull().default(0),
    // null = the org's default tax rate.
    taxRateId: text('tax_rate_id'),
  },
  (t) => {
    // "No class" and "no course" are indexed as '' (NULLs are distinct in a unique index),
    // written with CASE because drizzle-kit splits an index expression at its commas.
    const target = [
      t.orgId,
      sql`(case when ${t.classId} is null then '' else ${t.classId} end)`,
      sql`(case when ${t.courseId} is null then '' else ${t.courseId} end)`,
    ] as const;
    return [
      // The only index a query can use: the two below each need their own WHERE repeated. It
      // keeps a read to the org's own rules, and GET /price-rules pages in its order (D-101).
      uniqueIndex('price_rules_org_id_uq').on(t.orgId, t.id),
      // One target has at most one rule that fits a class in a term, and at most one that fits
      // a class with no term. A per_lesson or pack rule fits both, so it is in both indexes.
      uniqueIndex('price_rules_org_target_term_uq')
        .on(...target)
        .where(sql`${t.deletedAt} is null and ${t.basis} <> 'per_month'`),
      uniqueIndex('price_rules_org_target_no_term_uq')
        .on(...target)
        .where(sql`${t.deletedAt} is null and ${t.basis} <> 'per_term'`),
    ];
  },
);

// What a family owes for one invoice run: a term, or a calendar month for classes with no term.
// A run makes one invoice per family, with a line per enrolment it bills.
export const invoices = sqliteTable(
  'invoices',
  {
    ...orgColumns(),
    familyId: text('family_id').notNull(),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    // The period billed: term_id for a term run, month (`YYYY-MM`) for a monthly one.
    termId: text('term_id'),
    month: text('month'),
    // Local dates, both included.
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    // Minor units, in `currency`: the sums of the lines. total = subtotal + tax.
    currency: text('currency').notNull(),
    subtotalAmount: integer('subtotal_amount').notNull(),
    taxAmount: integer('tax_amount').notNull(),
    totalAmount: integer('total_amount').notNull(),
    // The sum of the payment allocations to it that aren't deleted, set in the batch that
    // records or deletes a payment, with the status that follows from it.
    paidAmount: integer('paid_amount').notNull().default(0),
    // Copied from the family when the invoice is generated.
    bankReference: text('bank_reference'),
    dueDate: text('due_date'),
    notes: text('notes'),
    issuedAt: text('issued_at'),
    voidedAt: text('voided_at'),
    // The days overdue (from the org's reminder days) the hourly cron has reminded the family
    // at, so it reminds once for each (TUI-67).
    remindedDays: text('reminded_days', { mode: 'json' }).$type<number[]>().notNull().default([]),
    // The job that generated it.
    jobId: text('job_id'),
  },
  (t) => [
    // GET /invoices pages in id order, newest first: through the first index, or through the one
    // for the filter it is given (D-101).
    uniqueIndex('invoices_org_id_uq').on(t.orgId, t.id),
    index('invoices_org_family_idx').on(t.orgId, t.familyId, t.id),
    index('invoices_org_status_idx').on(t.orgId, t.status, t.id),
    index('invoices_org_term_idx').on(t.orgId, t.termId, t.id),
    index('invoices_org_month_idx').on(t.orgId, t.month, t.id),
    index('invoices_org_job_idx').on(t.orgId, t.jobId),
  ],
);

// One enrolment's charge for the invoice's period. The price and the tax rate are copied on, so
// changing or deleting a price rule or a tax rate later doesn't change an invoice.
export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    ...orgColumns(),
    invoiceId: text('invoice_id').notNull(),
    enrolmentId: text('enrolment_id').notNull(),
    studentId: text('student_id').notNull(),
    classId: text('class_id').notNull(),
    // Copied from the invoice: the term id or the month, and the dates it covers.
    periodKey: text('period_key').notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    // The price for one `basis`, in the invoice's currency.
    unitAmount: integer('unit_amount').notNull(),
    // Lessons for per_lesson, packs for pack, 1 for per_term and per_month.
    quantity: integer('quantity').notNull(),
    // The lessons this line pays for. For a pack, the lessons its packs hold.
    lessons: integer('lessons').notNull(),
    // The lessons the class holds in the period. null for a pack, which isn't tied to one.
    periodLessons: integer('period_lessons'),
    // The enrolment's free-trial lessons that fell in the period.
    freeLessons: integer('free_lessons').notNull().default(0),
    // Where the price came from. null source = only the enrolment's override priced it.
    priceSource: text('price_source', { enum: PRICE_SOURCES }),
    priceRuleId: text('price_rule_id'),
    priceOverridden: integer('price_overridden', { mode: 'boolean' }).notNull().default(false),
    // The tax rate as it was when the invoice was generated. All null = no tax.
    taxRateId: text('tax_rate_id'),
    taxName: text('tax_name'),
    taxRateBps: integer('tax_rate_bps'),
    taxInclusive: integer('tax_inclusive', { mode: 'boolean' }),
    // Minor units. total = subtotal + tax.
    subtotalAmount: integer('subtotal_amount').notNull(),
    taxAmount: integer('tax_amount').notNull(),
    totalAmount: integer('total_amount').notNull(),
    // What discounts took off the charge before tax (TUI-58), in minor units, and which rules:
    // `[{ ruleId, name, amount }]`. 0 and null with none.
    discountAmount: integer('discount_amount').notNull().default(0),
    discounts: text('discounts', { mode: 'json' }).$type<
      { ruleId: string; name: string; amount: number }[]
    >(),
    // Set with the invoice's voided_at, so the enrolment can be invoiced for the period again.
    voidedAt: text('voided_at'),
  },
  (t) => [
    index('invoice_lines_org_invoice_idx').on(t.orgId, t.invoiceId),
    // An enrolment is invoiced once for a period. This is what makes a second run, a retried
    // job or two runs at once unable to bill it twice.
    uniqueIndex('invoice_lines_org_enrolment_period_uq')
      .on(t.orgId, t.enrolmentId, t.periodKey)
      .where(sql`${t.deletedAt} is null and ${t.voidedAt} is null`),
  ],
);

// Money a family paid, recorded by staff: payments are made outside the app. A payment pays
// towards one or more of the family's invoices, and its allocations add up to its amount.
export const payments = sqliteTable(
  'payments',
  {
    ...orgColumns(),
    familyId: text('family_id').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    // Minor units, in `currency`: the organisation's when it was recorded.
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    // Local date: the day the money came in.
    receivedOn: text('received_on').notNull(),
    reference: text('reference'),
    notes: text('notes'),
  },
  (t) => [
    // GET /payments pages in id order, newest first, through the first index or the family's
    // (D-101).
    uniqueIndex('payments_org_id_uq').on(t.orgId, t.id),
    index('payments_org_family_idx').on(t.orgId, t.familyId, t.id),
  ],
);

// What one payment pays towards one invoice, in the payment's currency. Deleting the payment
// deletes its allocations with it. A trigger (migration 0016) refuses one that would take an
// invoice past its total, or that goes to an invoice that isn't issued or part paid.
export const paymentAllocations = sqliteTable(
  'payment_allocations',
  {
    ...orgColumns(),
    paymentId: text('payment_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [
    // A payment pays towards an invoice once. Also the index a payment's allocations are read by.
    uniqueIndex('payment_allocations_org_payment_invoice_uq')
      .on(t.orgId, t.paymentId, t.invoiceId)
      .where(sql`${t.deletedAt} is null`),
    index('payment_allocations_org_invoice_idx').on(t.orgId, t.invoiceId),
  ],
);

// A discount an invoice run applies (TUI-58): sibling, multi-class, early-bird, scholarship,
// manual, or a bundle of courses (D-079). Each takes a percentage or an amount off a line's
// charge before tax, or for a bundle prices the bundle's lines at a fixed total.
export const discountRules = sqliteTable(
  'discount_rules',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    kind: text('kind', { enum: DISCOUNT_KINDS }).notNull(),
    // Exactly one of these three: basis points off, an amount off each line, or a bundle's total.
    percentBps: integer('percent_bps'),
    amount: integer('amount'),
    fixedPrice: integer('fixed_price'),
    currency: text('currency'),
    // Sibling: children in the family; multi-class: lines of the student. At least this many.
    minCount: integer('min_count'),
    // Bundle: the courses a student takes together.
    courseIds: text('course_ids', { mode: 'json' }).$type<string[]>(),
    // Scholarship: these students. Manual: these families.
    studentIds: text('student_ids', { mode: 'json' }).$type<string[]>(),
    familyIds: text('family_ids', { mode: 'json' }).$type<string[]>(),
    // Early-bird: enrolments made on or before this date, for this term's run (null = any run).
    cutoffDate: text('cutoff_date'),
    termId: text('term_id'),
    // The periods it applies to: a run whose period touches these dates. null = no limit.
    startsOn: text('starts_on'),
    endsOn: text('ends_on'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('discount_rules_org_id_uq').on(t.orgId, t.id)],
);
