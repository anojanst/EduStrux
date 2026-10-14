import { z } from '../zod';
import { CurrencyCode, LocalDate, Money, PageQuery, Timestamp } from './common';

/** How the money came in. Payments are recorded, not processed: none is taken in the app. */
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The most invoices one payment can pay towards. */
export const MAX_PAYMENT_ALLOCATIONS = 50;

const Method = z.enum(PAYMENT_METHODS).openapi({
  example: 'bank_transfer',
  description:
    'How the money came in: `cash`, `bank_transfer`, `cheque`, `card` (a card terminal at the ' +
    'centre) or `other`.',
});
/** More than 0, in the organisation's currency. */
const Amount = z
  .object({
    amount: z.number().int().min(1).openapi({ example: 45000 }),
    currency: CurrencyCode,
  })
  .openapi({ description: 'Minor units, more than 0, in the organisation’s currency.' });
const Reference = z.string().trim().max(100).nullable().openapi({
  example: '7K2M9QXA',
  description:
    'What identifies it: the reference on a bank transfer, a cheque number. null = none.',
});
const Notes = z.string().trim().max(2000).nullable().openapi({
  description: 'A note for staff. null = none.',
});

export const PaymentAllocation = z
  .object({
    invoiceId: z.string().openapi({ example: 'inv_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    amount: Money.openapi({ description: 'What this payment pays towards the invoice.' }),
  })
  .openapi('PaymentAllocation');
export type PaymentAllocation = z.infer<typeof PaymentAllocation>;

export const Payment = z
  .object({
    id: z.string().openapi({ example: 'pay_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    familyName: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    method: Method,
    amount: Money.openapi({ description: 'What was received.' }),
    receivedOn: LocalDate.openapi({ description: 'The day the money came in.' }),
    reference: Reference,
    notes: Notes,
    allocations: z.array(PaymentAllocation).openapi({
      description: 'The invoices it pays towards. Their amounts add up to `amount`.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Payment');
export type Payment = z.infer<typeof Payment>;

export const CreatePayment = z
  .object({
    familyId: z.string().openapi({ example: 'fam_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    method: Method,
    amount: Amount,
    receivedOn: LocalDate.optional().openapi({
      description: 'The day the money came in, not after today. Left out: today.',
    }),
    reference: Reference.optional(),
    notes: Notes.optional(),
    allocations: z
      .array(
        z.object({
          invoiceId: z.string(),
          amount: Amount.openapi({ description: 'What to pay towards this invoice.' }),
        }),
      )
      .min(1)
      .max(MAX_PAYMENT_ALLOCATIONS)
      .openapi({
        description:
          'The family’s issued or part-paid invoices it pays towards, each at most once. The ' +
          'amounts add up to `amount`.',
      }),
  })
  .superRefine((payment, issues) => {
    const seen = new Set<string>();
    let sum = 0;
    payment.allocations.forEach((allocation, i) => {
      if (seen.has(allocation.invoiceId)) {
        issues.addIssue({
          code: 'custom',
          path: ['allocations', i, 'invoiceId'],
          message: 'The same invoice twice',
        });
      }
      seen.add(allocation.invoiceId);
      if (allocation.amount.currency !== payment.amount.currency) {
        issues.addIssue({
          code: 'custom',
          path: ['allocations', i, 'amount', 'currency'],
          message: 'Must be the payment’s currency',
        });
      }
      sum += allocation.amount.amount;
    });
    if (sum !== payment.amount.amount) {
      issues.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Must add up to the amount',
      });
    }
  })
  .openapi('CreatePayment');
export type CreatePayment = z.infer<typeof CreatePayment>;

export const PaymentQuery = PageQuery.extend({
  familyId: z.string().optional().openapi({ description: 'Only this family’s payments' }),
  invoiceId: z.string().optional().openapi({ description: 'Only payments towards this invoice' }),
});
