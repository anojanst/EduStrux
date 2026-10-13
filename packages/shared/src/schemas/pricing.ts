import { z } from '../zod';
import { CurrencyCode, Money, PageQuery, Timestamp } from './common';

/**
 * What a price is charged for. `per_term` only fits a class in a term and `per_month` a class
 * with no term, since that is how each is billed. `per_lesson` and `pack` fit both.
 */
export const PRICE_BASES = ['per_term', 'per_month', 'per_lesson', 'pack'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** Whether a price on this basis can apply to a class: one in a term, or one with none. */
export function basisFitsClass(basis: PriceBasis, inTerm: boolean): boolean {
  if (basis === 'per_term') return inTerm;
  if (basis === 'per_month') return !inTerm;
  return true;
}

/** Whether some class could be priced on either basis, so two rules with them would compete. */
export function basesOverlap(a: PriceBasis, b: PriceBasis): boolean {
  return [true, false].some((inTerm) => basisFitsClass(a, inTerm) && basisFitsClass(b, inTerm));
}

/** Where an enrolment's usual price came from, most specific first. */
export const PRICE_SOURCES = ['class_rule', 'course_rule', 'course_default', 'org_rule'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const MIN_PACK_LESSONS = 2;
export const MAX_PACK_LESSONS = 200;
export const MAX_FREE_TRIAL_LESSONS = 20;

const Basis = z.enum(PRICE_BASES).openapi({
  example: 'per_term',
  description:
    'What the price is charged for: `per_term` (a class in a term), `per_month` (a class with ' +
    'no term), `per_lesson`, or `pack` (a block of `packLessons` lessons, invoiced up front).',
});
/** A price can't be negative; 0 is free. The currency must be the organisation's. */
const Price = z
  .object({
    amount: z.number().int().min(0).openapi({ example: 45000 }),
    currency: CurrencyCode,
  })
  .openapi({ description: 'The price for one `basis`, in the organisation’s currency.' });
const PackLessons = z.number().int().min(MIN_PACK_LESSONS).max(MAX_PACK_LESSONS).openapi({
  example: 10,
  description: 'How many lessons one pack buys. Only for the `pack` basis.',
});
const FreeTrialLessons = z.number().int().min(0).max(MAX_FREE_TRIAL_LESSONS).openapi({
  example: 1,
  description: 'The first lessons of a student’s enrolment that aren’t charged. 0 = no trial.',
});
const TaxRateId = z.string().nullable().openapi({
  example: 'txr_01j9z3k6m2q8w4e5r6t7y8u9i0',
  description: 'The tax rate for this price. null = the organisation’s default tax rate.',
});
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});

export const PriceRule = z
  .object({
    id: z.string().openapi({ example: 'prr_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    courseId: z.string().nullable().openapi({ description: 'The course this rule prices.' }),
    classId: z.string().nullable().openapi({
      description: 'The class this rule prices. With no course either, it prices every class.',
    }),
    basis: z.enum(PRICE_BASES),
    price: Money,
    packLessons: z.number().int().nullable(),
    freeTrialLessons: z.number().int(),
    taxRateId: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('PriceRule');
export type PriceRule = z.infer<typeof PriceRule>;

export const CreatePriceRule = z
  .object({
    courseId: z.string().nullable().optional().openapi({
      example: 'crs_01j9z3k6m2q8w4e5r6t7y8u9i0',
      description: 'Price this course’s classes. Leave out, with `classId`, for every class.',
    }),
    classId: z.string().nullable().optional().openapi({
      example: null,
      description: 'Price this one class. Not together with `courseId`.',
    }),
    basis: Basis,
    price: Price,
    packLessons: PackLessons.nullable().optional(),
    freeTrialLessons: FreeTrialLessons.default(0),
    taxRateId: TaxRateId.optional(),
  })
  .refine((v) => v.courseId == null || v.classId == null, {
    message: 'Give a course or a class, not both',
    path: ['classId'],
  })
  .refine((v) => v.basis !== 'pack' || v.packLessons != null, {
    message: 'Required for a pack',
    path: ['packLessons'],
  })
  .refine((v) => v.basis === 'pack' || v.packLessons == null, {
    message: 'Only a pack has lessons',
    path: ['packLessons'],
  })
  .openapi('CreatePriceRule');
export type CreatePriceRule = z.infer<typeof CreatePriceRule>;

/** A rule keeps what it prices and its basis: there's no courseId, classId or basis here. */
export const UpdatePriceRule = z
  .object({
    updatedAt: UpdatedAt,
    price: Price,
    packLessons: PackLessons,
    freeTrialLessons: FreeTrialLessons,
    taxRateId: TaxRateId,
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdatePriceRule');
export type UpdatePriceRule = z.infer<typeof UpdatePriceRule>;

export const PriceRuleQuery = PageQuery.extend({
  courseId: z.string().optional().openapi({ description: 'Only this course’s own rules' }),
  classId: z.string().optional().openapi({ description: 'Only this class’s own rule' }),
});
