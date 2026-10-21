import { z } from '../zod';
import { LocalDate, Money, PageQuery, Timestamp } from './common';
import { LineDiscount } from './discounts';
import { PRICE_BASES, PRICE_SOURCES } from './pricing';

/**
 * A run makes a `draft`. Issuing it makes it `issued`, and payments towards it make it `part_paid`
 * or `paid`. A draft or an issued invoice can be voided; one with payments can't.
 */
export const INVOICE_STATUSES = ['draft', 'issued', 'part_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Why a run left an enrolment off its invoices. `no_price`: nothing prices it. `no_lessons`: its
 * class holds no lessons in the period on the dates the enrolment covers. `free_trial`: every
 * lesson falls in its free trial. `free`: its price is 0. `pack_covers`: the packs already
 * invoiced cover the period. `currency_mismatch`: its price isn't in the organisation's
 * currency. `other_branch`: its family's home branch is outside the branches of whoever started
 * the run.
 */
export const INVOICE_SKIP_REASONS = [
  'no_price',
  'no_lessons',
  'free_trial',
  'free',
  'pack_covers',
  'currency_mismatch',
  'other_branch',
] as const;
export type InvoiceSkipReason = (typeof INVOICE_SKIP_REASONS)[number];

/** A calendar month, for classes with no term: `2026-11`. */
export const BillingMonth = z
  .string()
  .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/, 'A month like 2026-11')
  .openapi({ example: '2026-11' });

const DueDate = LocalDate.nullable().openapi({
  description: 'The day payment is due. null = no due date.',
  example: '2026-11-20',
});
const Notes = z.string().trim().max(2000).nullable().openapi({
  description: 'A note to the family, shown on the invoice. null = none.',
});

export const InvoiceLine = z
  .object({
    id: z.string().openapi({ example: 'inl_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    enrolmentId: z.string(),
    studentId: z.string(),
    studentFirstName: z.string(),
    studentLastName: z.string(),
    classId: z.string(),
    className: z.string(),
    courseId: z.string(),
    basis: z.enum(PRICE_BASES),
    unitPrice: Money.openapi({
      description: 'The price for one `basis`, copied when the invoice was generated.',
    }),
    quantity: z.number().int().openapi({
      description: 'Lessons for `per_lesson`, packs for `pack`, 1 for `per_term` and `per_month`.',
    }),
    lessons: z.number().int().openapi({
      description: 'The lessons this line pays for. For a pack, the lessons its packs hold.',
    }),
    periodLessons: z
      .number()
      .int()
      .nullable()
      .openapi({
        description:
          'The lessons the class holds in the period. A `per_term` or `per_month` price is charged ' +
          'as `lessons` out of `periodLessons`. null for a pack.',
      }),
    freeLessons: z.number().int().openapi({
      description: 'The enrolment’s free-trial lessons in the period, which aren’t charged.',
    }),
    priceSource: z.enum(PRICE_SOURCES).nullable().openapi({
      description: 'Where the price came from. null = only the enrolment’s override priced it.',
    }),
    priceRuleId: z.string().nullable(),
    priceOverridden: z.boolean().openapi({
      description: 'true = `unitPrice` is the enrolment’s price override.',
    }),
    taxRateId: z.string().nullable(),
    taxName: z.string().nullable(),
    taxRateBps: z.number().int().nullable().openapi({
      description: 'The tax rate in basis points when the invoice was generated. null = no tax.',
    }),
    taxInclusive: z.boolean().nullable().openapi({
      description: 'true = `unitPrice` already includes the tax.',
    }),
    discount: Money.openapi({
      description: 'What discounts took off the charge before tax (TUI-58). 0 with none.',
    }),
    discounts: z.array(LineDiscount).openapi({
      description: 'Each discount rule applied, and what it took off.',
    }),
    subtotal: Money.openapi({ description: 'The charge before tax, less any discount.' }),
    tax: Money,
    total: Money.openapi({ description: '`subtotal` plus `tax`.' }),
  })
  .openapi('InvoiceLine');
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const Invoice = z
  .object({
    id: z.string().openapi({ example: 'inv_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    familyName: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    status: z.enum(INVOICE_STATUSES),
    termId: z.string().nullable().openapi({ description: 'The term billed, for a term run.' }),
    month: BillingMonth.nullable().openapi({
      description: 'The month billed, for a monthly run.',
    }),
    periodStart: LocalDate,
    periodEnd: LocalDate,
    bankReference: z.string().nullable().openapi({
      description: 'What the family quotes on a bank transfer.',
      example: '7K2M9QXA',
    }),
    dueDate: DueDate,
    notes: Notes,
    subtotal: Money.openapi({ description: 'The lines’ charges before tax.' }),
    tax: Money,
    total: Money.openapi({ description: '`subtotal` plus `tax`: what the family owes.' }),
    paid: Money.openapi({ description: 'What payments have paid towards it so far.' }),
    balance: Money.openapi({
      description: 'What is still to pay: `total` less `paid`. 0 for a void invoice.',
    }),
    lines: z.array(InvoiceLine),
    issuedAt: Timestamp.nullable(),
    voidedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Invoice');
export type Invoice = z.infer<typeof Invoice>;

/** Only the due date and the note can change. The lines are fixed: void the invoice and run again. */
export const UpdateInvoice = z
  .object({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
    dueDate: DueDate,
    notes: Notes,
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateInvoice');
export type UpdateInvoice = z.infer<typeof UpdateInvoice>;

export const InvoiceQuery = PageQuery.extend({
  familyId: z.string().optional().openapi({ description: 'Only this family’s invoices' }),
  branchId: z.string().optional().openapi({
    description: 'Only invoices of families whose home branch this is',
  }),
  termId: z.string().optional().openapi({ description: 'Only invoices for this term' }),
  month: BillingMonth.optional().openapi({ description: 'Only invoices for this month' }),
  status: z.enum(INVOICE_STATUSES).optional(),
});

export const GenerateInvoices = z
  .object({
    dueDate: DueDate.optional().openapi({
      description: 'The due date for every invoice the run makes. Leave out for none.',
    }),
  })
  .openapi('GenerateInvoices');
export type GenerateInvoices = z.infer<typeof GenerateInvoices>;

export const GenerateMonthlyInvoices = GenerateInvoices.extend({
  month: BillingMonth.openapi({ description: 'The month to bill.' }),
}).openapi('GenerateMonthlyInvoices');
export type GenerateMonthlyInvoices = z.infer<typeof GenerateMonthlyInvoices>;

/**
 * A finished invoice run's `result` on its job. `invoices`, `lines` and `total` are what the run
 * made. `alreadyInvoiced` counts the enrolments an earlier run had billed for the period.
 */
export const InvoiceRunResult = z
  .object({
    termId: z.string().nullable(),
    month: BillingMonth.nullable(),
    periodStart: LocalDate,
    periodEnd: LocalDate,
    invoices: z.number().int(),
    lines: z.number().int(),
    total: Money,
    alreadyInvoiced: z.number().int(),
    skipped: z.array(
      z.object({
        enrolmentId: z.string(),
        studentId: z.string(),
        classId: z.string(),
        reason: z.enum(INVOICE_SKIP_REASONS),
      }),
    ),
  })
  .openapi('InvoiceRunResult');
export type InvoiceRunResult = z.infer<typeof InvoiceRunResult>;
