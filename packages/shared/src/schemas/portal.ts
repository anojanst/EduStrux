import { z } from '../zod';
import { Session } from './classes';
import { LocalDate, PageQuery } from './common';
import { Enrolment } from './enrolment';
import { INVOICE_STATUSES, Invoice, InvoiceLine } from './invoices';

// The parent portal: what a signed-in parent sees of their own family (D-126). Each shape is the
// staff one with what a parent needs beside it, less what is only for staff.

export const PortalChild = z
  .object({
    id: z.string().openapi({ example: 'stu_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    familyId: z.string(),
    familyName: z.string(),
    branchId: z.string().openapi({ description: 'The family’s home branch.' }),
    firstName: z.string(),
    lastName: z.string(),
    gradeLevelId: z.string().nullable().openapi({
      description: 'The child’s grade level in the current academic year. null = none recorded.',
    }),
    enrolments: z.array(Enrolment).openapi({
      description: 'The child’s active enrolments, oldest first, each with its price override.',
    }),
  })
  .openapi('PortalChild');
export type PortalChild = z.infer<typeof PortalChild>;

export const PortalChildList = z
  .object({
    data: z.array(PortalChild),
    nextCursor: z.null().openapi({ description: 'Always null: the whole list is returned.' }),
  })
  .openapi('PortalChildList');

export const PortalSession = Session.extend({
  children: z
    .array(z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }))
    .openapi({
      description:
        'Which of your children the session is for: those whose active enrolment covers its date.',
    }),
}).openapi('PortalSession');
export type PortalSession = z.infer<typeof PortalSession>;

export const PortalSessionQuery = PageQuery.extend({
  from: LocalDate.openapi({ description: 'The first date to include', example: '2026-10-12' }),
  to: LocalDate.openapi({ description: 'The last date to include', example: '2026-10-18' }),
  studentId: z.string().optional().openapi({ description: 'Only this child’s sessions' }),
}).refine(
  (q) =>
    !LocalDate.safeParse(q.from).success || !LocalDate.safeParse(q.to).success || q.to >= q.from,
  { message: 'Must be on or after from', path: ['to'] },
);

/** A line as a parent reads it: without which price rule priced it, which is for staff. */
export const PortalInvoiceLine = InvoiceLine.omit({ priceSource: true, priceRuleId: true }).openapi(
  'PortalInvoiceLine',
);
export type PortalInvoiceLine = z.infer<typeof PortalInvoiceLine>;

export const PortalInvoice = Invoice.extend({ lines: z.array(PortalInvoiceLine) }).openapi(
  'PortalInvoice',
);
export type PortalInvoice = z.infer<typeof PortalInvoice>;

export const PortalInvoiceQuery = PageQuery.extend({
  familyId: z.string().optional().openapi({ description: 'Only this family’s invoices' }),
  status: z.enum(INVOICE_STATUSES).optional(),
});
