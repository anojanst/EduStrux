import { z } from '../zod';
import { LocalDate, Money } from './common';
import { PAYMENT_METHODS } from './payments';

// Reports (TUI-62, TUI-63). Money in the organisation's currency, dates local.

/** The longest a money report covers, in days, both ends included. */
export const MAX_REPORT_DAYS = 366;

export const MoneyReportQuery = z
  .object({
    from: LocalDate.openapi({ example: '2026-01-01' }),
    to: LocalDate.openapi({ example: '2026-12-31' }),
  })
  .refine(
    (q) =>
      !LocalDate.safeParse(q.from).success || !LocalDate.safeParse(q.to).success || q.to >= q.from,
    { message: 'Must be on or after from', path: ['to'] },
  );

export const AgedDebt = z
  .object({
    asOf: LocalDate,
    invoices: z.number().int().openapi({ description: 'Invoices with something still owing.' }),
    total: Money,
    notDue: Money.openapi({ description: 'Not yet due, or with no due date.' }),
    days1to30: Money,
    days31to60: Money,
    days61to90: Money,
    over90: Money,
  })
  .openapi('AgedDebt');

export const MoneyReport = z
  .object({
    from: LocalDate,
    to: LocalDate,
    invoiced: Money.openapi({
      description: 'The totals of invoices issued in the dates, void ones left out.',
    }),
    received: Money.openapi({ description: 'Payments received in the dates.' }),
    byMonth: z.array(z.object({ month: z.string(), invoiced: Money, received: Money })),
    receivedByMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: Money })),
    agedDebt: AgedDebt.openapi({
      description: 'What is owed today, by how long past its due date. Not limited to the dates.',
    }),
    tax: z
      .array(
        z.object({
          taxRateId: z.string().nullable(),
          name: z.string().nullable().openapi({ description: 'null = no tax.' }),
          rateBps: z.number().int().nullable(),
          inclusive: z.boolean().nullable(),
          taxable: Money.openapi({ description: 'The lines’ charges before tax.' }),
          tax: Money,
        }),
      )
      .openapi({
        description:
          'Tax on the invoices issued in the dates (void ones left out), by rate as invoiced.',
      }),
    taxTotal: Money,
  })
  .openapi('MoneyReport');
export type MoneyReport = z.infer<typeof MoneyReport>;

export const Dashboard = z
  .object({
    date: LocalDate.openapi({ description: 'Today, in the organisation’s timezone.' }),
    families: z.number().int(),
    students: z.number().int().openapi({ description: 'With an active enrolment.' }),
    classes: z.number().int().openapi({ description: 'Running today or still to start.' }),
    today: z.object({
      lessons: z.number().int(),
      cancelled: z.number().int(),
      marked: z.number().int().openapi({ description: 'Lessons today with any attendance marked.' }),
      absenceNotices: z.number().int().openapi({ description: 'Students away today.' }),
    }),
    unmarkedLessons: z.number().int().openapi({
      description: 'Lessons in the last 14 days, today included, with no attendance marked.',
    }),
    makeupCreditsAvailable: z.number().int(),
    money: z
      .object({
        owing: Money,
        overdue: Money,
        overdueInvoices: z.number().int(),
        receivedThisMonth: Money,
        draftInvoices: z.number().int(),
      })
      .optional()
      .openapi({ description: 'Left out for roles that don’t see money: teachers and front desk.' }),
  })
  .openapi('Dashboard');
export type Dashboard = z.infer<typeof Dashboard>;
