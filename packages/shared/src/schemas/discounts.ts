import { z } from '../zod';
import { CurrencyCode, LocalDate, PageQuery, Timestamp } from './common';

// Discounts an invoice run applies (TUI-58). Bundles are built here too (D-079).

/**
 * - `sibling`: every child of a family with at least `minCount` children billed in the run, but
 *   the one charged most.
 * - `multi_class`: every line of a student with at least `minCount` lines in the run, but their
 *   dearest. Lines priced by a bundle don't count or get it (D-079).
 * - `early_bird`: enrolments made on or before `cutoffDate`, in `termId`'s run (or any).
 * - `scholarship`: these students. `manual`: these families.
 * - `bundle`: a student billed for every one of `courseIds` in the run pays `fixedPrice` for those
 *   lines together, or gets the percentage or amount off each.
 */
export const DISCOUNT_KINDS = [
  'sibling',
  'multi_class',
  'early_bird',
  'scholarship',
  'manual',
  'bundle',
] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

const Ids = z.array(z.string()).min(1).max(100);

const DiscountFields = z.object({
  name: z.string().trim().min(1).max(120).openapi({ example: 'Sibling discount' }),
  kind: z.enum(DISCOUNT_KINDS),
  percentBps: z.number().int().min(1).max(10_000).nullable().optional().openapi({
    description: 'Basis points off each line’s charge before tax: 1000 = 10%.',
  }),
  amount: z
    .object({ amount: z.number().int().min(1), currency: CurrencyCode })
    .nullable()
    .optional()
    .openapi({ description: 'An amount off each line’s charge, at most the charge.' }),
  fixedPrice: z
    .object({ amount: z.number().int().min(0), currency: CurrencyCode })
    .nullable()
    .optional()
    .openapi({ description: 'A bundle only: what its lines cost together.' }),
  minCount: z.number().int().min(2).max(20).nullable().optional().openapi({
    description: 'Sibling: children billed. Multi-class: the student’s lines. Default 2.',
  }),
  courseIds: z.array(z.string()).min(2).max(20).nullable().optional(),
  studentIds: Ids.nullable().optional(),
  familyIds: Ids.nullable().optional(),
  cutoffDate: LocalDate.nullable().optional(),
  termId: z.string().nullable().optional(),
  startsOn: LocalDate.nullable().optional().openapi({
    description: 'Only for runs whose period ends on or after this date.',
  }),
  endsOn: LocalDate.nullable().optional().openapi({
    description: 'Only for runs whose period starts on or before this date.',
  }),
  active: z.boolean().default(true),
});

/** What each kind needs, and what it can't have. */
function checkKind(
  rule: Partial<z.infer<typeof DiscountFields>>,
  ctx: z.RefinementCtx,
  kind: DiscountKind | undefined,
) {
  const has = (field: keyof typeof rule) => rule[field] !== undefined && rule[field] !== null;
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', message, path: [path] });
  const offs = (['percentBps', 'amount', 'fixedPrice'] as const).filter(has);
  if (offs.length !== 1) issue('_', 'Send one of percentBps, amount or fixedPrice');
  if (has('fixedPrice') && kind !== 'bundle') issue('fixedPrice', 'Only for a bundle');
  const need = (field: keyof typeof rule) => {
    if (!has(field)) issue(field, 'Required');
  };
  const refuse = (...fields: (keyof typeof rule)[]) => {
    for (const field of fields) if (has(field)) issue(field, `Not for ${kind}`);
  };
  switch (kind) {
    case 'sibling':
    case 'multi_class':
      refuse('courseIds', 'studentIds', 'familyIds', 'cutoffDate', 'termId');
      break;
    case 'early_bird':
      need('cutoffDate');
      refuse('minCount', 'courseIds', 'studentIds', 'familyIds');
      break;
    case 'scholarship':
      need('studentIds');
      refuse('minCount', 'courseIds', 'familyIds', 'cutoffDate', 'termId');
      break;
    case 'manual':
      need('familyIds');
      refuse('minCount', 'courseIds', 'studentIds', 'cutoffDate', 'termId');
      break;
    case 'bundle':
      need('courseIds');
      refuse('minCount', 'studentIds', 'familyIds', 'cutoffDate', 'termId');
      break;
  }
  if (rule.startsOn && rule.endsOn && rule.endsOn < rule.startsOn) {
    issue('endsOn', 'Must be on or after startsOn');
  }
}

export const CreateDiscountRule = DiscountFields.superRefine((rule, ctx) =>
  checkKind(rule, ctx, rule.kind),
).openapi('CreateDiscountRule');
export type CreateDiscountRule = z.infer<typeof CreateDiscountRule>;

/**
 * Any field but `kind`, with `updatedAt`. The rule as changed must still suit its kind (400). A
 * change applies to runs from then on; invoices already made keep their discounts.
 */
export const UpdateDiscountRule = DiscountFields.omit({ kind: true })
  .partial()
  .extend({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
  })
  .openapi('UpdateDiscountRule');
export type UpdateDiscountRule = z.infer<typeof UpdateDiscountRule>;

/** Checks a rule as it will be stored once changed, for PATCH. */
export function discountRuleIssues(rule: Partial<CreateDiscountRule> & { kind: DiscountKind }) {
  const result = DiscountFields.superRefine((r, ctx) => checkKind(r, ctx, r.kind)).safeParse(rule);
  return result.success ? null : result.error.issues;
}

const MoneyOut = z.object({ amount: z.number().int(), currency: z.string() });

export const DiscountRule = z
  .object({
    id: z.string().openapi({ example: 'dsr_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    kind: z.enum(DISCOUNT_KINDS),
    percentBps: z.number().int().nullable(),
    amount: z.union([MoneyOut, z.null()]),
    fixedPrice: z.union([MoneyOut, z.null()]),
    minCount: z.number().int().nullable(),
    courseIds: z.array(z.string()).nullable(),
    studentIds: z.array(z.string()).nullable(),
    familyIds: z.array(z.string()).nullable(),
    cutoffDate: LocalDate.nullable(),
    termId: z.string().nullable(),
    startsOn: LocalDate.nullable(),
    endsOn: LocalDate.nullable(),
    active: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('DiscountRule');
export type DiscountRule = z.infer<typeof DiscountRule>;

export const DiscountRuleQuery = PageQuery.extend({
  kind: z.enum(DISCOUNT_KINDS).optional(),
});

/** What a discount took off one invoice line. */
export const LineDiscount = z
  .object({
    ruleId: z.string(),
    name: z.string(),
    amount: MoneyOut,
  })
  .openapi('LineDiscount');
