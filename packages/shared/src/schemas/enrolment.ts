import { z } from '../zod';
import { CurrencyCode, LocalDate, Money, PageQuery, Timestamp } from './common';

/** `withdrawn` arrives with transfers and withdrawals; only `active` is written so far. */
export const ENROLMENT_STATUSES = ['active', 'withdrawn'] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

/** A price can't be negative; 0 is free. The currency must be the organisation's. */
const PriceOverride = z
  .object({
    amount: z.number().int().min(0).openapi({ example: 4000 }),
    currency: CurrencyCode,
  })
  .nullable()
  .openapi({
    description:
      'What this student pays for the class instead of its usual price, in the organisation’s ' +
      'currency. null = no override. How it is charged comes with price rules.',
  });

export const Enrolment = z
  .object({
    id: z.string().openapi({ example: 'enr_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    studentId: z.string(),
    studentFirstName: z.string(),
    studentLastName: z.string(),
    classId: z.string(),
    className: z.string(),
    courseId: z.string(),
    branchId: z.string().openapi({ description: 'The class’s branch.' }),
    startDate: LocalDate.openapi({ description: 'The first day the student is in the class.' }),
    endDate: LocalDate.nullable().openapi({
      description: 'The last day the student is in the class. null = until the class ends.',
    }),
    // A union rather than Money.nullable(): the OpenAPI generator drops "or null" from a $ref.
    priceOverride: z.union([Money, z.null()]),
    status: z.enum(ENROLMENT_STATUSES),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Enrolment');
export type Enrolment = z.infer<typeof Enrolment>;

export const CreateEnrolment = z
  .object({
    studentId: z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    classId: z.string().openapi({ example: 'cls_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    startDate: LocalDate.optional().openapi({
      description:
        'The first day the student is in the class. Leave out for today, or the class’s first ' +
        'day when that is still to come. It must fall inside the class’s dates.',
    }),
    endDate: LocalDate.nullable().optional().openapi({
      description: 'The last day the student is in the class. Leave out to stay until it ends.',
    }),
    priceOverride: PriceOverride.optional(),
  })
  .refine(
    // Compared only when both are real dates; a malformed one already has its own error.
    (v) =>
      !LocalDate.safeParse(v.startDate).success ||
      !LocalDate.safeParse(v.endDate).success ||
      v.endDate! >= v.startDate!,
    { message: 'Must be on or after startDate', path: ['endDate'] },
  )
  .openapi('CreateEnrolment');
export type CreateEnrolment = z.infer<typeof CreateEnrolment>;

export const EnrolmentQuery = PageQuery.extend({
  studentId: z.string().optional().openapi({ description: 'Only this student’s enrolments' }),
  classId: z.string().optional().openapi({ description: 'Only this class’s enrolments' }),
});
