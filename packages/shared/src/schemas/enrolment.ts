import { z } from '../zod';
import { CurrencyCode, LocalDate, Money, PageQuery, Timestamp } from './common';

/** `withdrawn`: the student left the class, by a withdrawal or a transfer, after `endDate`. */
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
      'currency. null = no override. It is charged on the basis of the price it replaces: per ' +
      'term or per month unless a price rule says per lesson or per pack.',
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
    // Left out, not null, for teachers, since null means no override.
    priceOverride: z
      .union([Money, z.null()])
      .optional()
      .openapi({ description: 'null = no override. Left out for teachers (D-110).' }),
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

// ── Changing, withdrawing and transferring (TUI-46) ─────────────────────────

const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});

export const UpdateEnrolment = z
  .object({
    updatedAt: UpdatedAt,
    startDate: LocalDate.openapi({ description: 'Inside the class’s dates.' }),
    endDate: LocalDate.nullable().openapi({
      description:
        'The last day in the class; null = until it ends. With `status: "withdrawn"`, the last ' +
        'day before leaving, today when left out; the day before `startDate` means the student ' +
        'never started.',
    }),
    priceOverride: PriceOverride,
    status: z.literal('withdrawn').openapi({
      description: 'Withdraws the student. A withdrawn enrolment can’t be changed again.',
    }),
    transfer: z
      .object({
        classId: z.string().openapi({ description: 'The class the student moves to.' }),
        startDate: LocalDate.optional().openapi({
          description:
            'The first day in the new class. Leave out for today, or the new class’s first day ' +
            'when that is still to come. The old enrolment ends the day before.',
        }),
        priceOverride: PriceOverride.optional().openapi({
          description: 'For the new enrolment. Not carried over from the old one.',
        }),
      })
      .openapi('EnrolmentTransfer'),
  })
  .partial()
  .required({ updatedAt: true })
  .refine((v) => !(v.transfer && (v.status || v.endDate !== undefined || v.startDate)), {
    message: 'A transfer sets the dates itself; send it on its own',
    path: ['transfer'],
  })
  .openapi('UpdateEnrolment');
export type UpdateEnrolment = z.infer<typeof UpdateEnrolment>;

export const InvoiceAdjustment = z
  .object({
    invoiceId: z.string(),
    invoiceLineId: z.string(),
    invoiceStatus: z.enum(['draft', 'issued', 'part_paid', 'paid', 'void']).openapi({
      description: 'The invoice’s status after the change.',
    }),
    adjusted: z.boolean().openapi({
      description:
        'true: a draft’s line was charged again for the new dates (or removed when no lesson ' +
        'is left), and the draft’s totals changed with it. false: the invoice is issued, so ' +
        'its lines are fixed; `after` is what the line would charge now. Void it and generate ' +
        'again to bill the new amount, while nothing is paid towards it.',
    }),
    lessonsBefore: z.number().int(),
    lessonsAfter: z.number().int(),
    before: Money.openapi({ description: 'The line’s total before the change.' }),
    after: Money.openapi({ description: 'The line’s total for the new dates.' }),
  })
  .openapi('InvoiceAdjustment');
export type InvoiceAdjustment = z.infer<typeof InvoiceAdjustment>;

export const EnrolmentUpdate = z
  .object({
    enrolment: Enrolment,
    transferredTo: z.union([Enrolment, z.null()]).openapi({
      description: 'The new enrolment a transfer made. null otherwise.',
    }),
    invoices: z.array(InvoiceAdjustment).openapi({
      description:
        'The enrolment’s invoice lines whose charge the new dates change, pro rata by lessons. ' +
        'Per-term, per-month and per-lesson lines only: packs are bought up front and carry ' +
        'over.',
    }),
  })
  .openapi('EnrolmentUpdate');
export type EnrolmentUpdate = z.infer<typeof EnrolmentUpdate>;
