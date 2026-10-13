import {
  BillingMonth,
  LocalDate,
  newId,
  z,
  type InvoiceRunResult,
  type InvoiceSkipReason,
} from '@edustrux/shared';
import type { JobContext } from '../../background/jobs';
import type { JobMessage } from '../../background/messages';
import type { Access, OrgCtx } from '../../db/scope';
import { forbidden } from '../../lib/errors';
import * as calendar from '../calendar/service';
import * as classes from '../classes/service';
import * as curriculum from '../curriculum/service';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import { startJob } from '../platform/service';
import { chargeFor, monthRange, withTax } from './invoicing';
import * as repo from './repository';
import { loadPricing } from './service';

/** The job type of an invoice run. */
export const INVOICE_RUN = 'invoices.generate';

/** What a run bills: a term's classes, or the classes with no term for one calendar month. */
export type RunTarget = { termId: string } | { month: string };

const RunInput = z.object({
  termId: z.string().nullable(),
  month: BillingMonth.nullable(),
  dueDate: LocalDate.nullable(),
  /** The branches of whoever started the run. null = every branch. */
  branchIds: z.array(z.string()).nullable(),
});
type RunInput = z.infer<typeof RunInput>;

/**
 * Queues an invoice run and returns its job id. The run bills the families the caller reaches:
 * staff limited to some branches bill the families whose home branch is one of theirs.
 */
export async function startInvoiceRun(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<JobMessage>,
  target: RunTarget,
  dueDate: string | null,
): Promise<string> {
  if (access.scope === 'own') throw forbidden();
  if ('termId' in target) await calendar.getTerm(ctx, target.termId);
  const input: RunInput = {
    termId: 'termId' in target ? target.termId : null,
    month: 'month' in target ? target.month : null,
    dueDate,
    branchIds: access.scope === 'branch' ? access.branchIds : null,
  };
  return startJob(ctx, queue, INVOICE_RUN, input);
}

type Draft = {
  invoice: repo.NewInvoiceRow & { id: string };
  lines: (repo.NewInvoiceLineRow & { id: string })[];
};

/**
 * The job behind an invoice run. It makes one draft invoice per family, with a line for each of
 * the family's enrolments it bills, and reports the enrolments it left out and why.
 *
 * Running it again is safe. An enrolment is invoiced once for a period: a run leaves out the
 * ones that already have a line for it, and a unique index refuses a second line if two runs
 * overlap. Everything a run makes is written as one batch, so a failed try leaves nothing
 * behind, and the result counts what the job made on any of its tries.
 */
export async function generateInvoices(ctx: JobContext): Promise<InvoiceRunResult> {
  const input = RunInput.parse(ctx.input);
  const key = input.termId ?? input.month;
  if (!key) throw new Error('An invoice run needs a term or a month');
  const [org, term] = await Promise.all([
    orgs.getOrg(ctx),
    input.termId ? calendar.getTerm(ctx, input.termId) : null,
  ]);
  const period = term
    ? { startDate: term.startDate, endDate: term.endDate }
    : monthRange(input.month!);

  const billed = await classes.classesBilledIn(ctx, term ? { termId: term.id } : period);
  const classOf = new Map(billed.map((klass) => [klass.id, klass]));
  const classIds = [...classOf.keys()];
  const enrolments = await enrolment.enrolmentsToInvoice(ctx, classIds, period);
  const [familyOf, defaultPrices, priceOf, taxRates, invoiced] = await Promise.all([
    people.familyIdsOfStudents(ctx, [...new Set(enrolments.map((e) => e.studentId))]),
    curriculum.defaultPrices(ctx, [...new Set(billed.map((klass) => klass.courseId))]),
    loadPricing(ctx),
    repo.allTaxRates(ctx),
    repo.linesInvoiced(
      ctx,
      enrolments.map((e) => e.id),
    ),
  ]);
  const families = await people.familyLabels(ctx, [...new Set(familyOf.values())]);

  const priced = enrolments.map((e) => {
    const klass = classOf.get(e.classId)!;
    const price = priceOf({
      classId: klass.id,
      courseId: klass.courseId,
      termId: klass.termId,
      defaultPrice: defaultPrices.get(klass.courseId) ?? null,
      priceOverride: e.priceOverride,
    });
    return { enrolment: e, price };
  });
  // A pack and a free trial count an enrolment's lessons from its first day, so read back that far.
  const from = priced.reduce(
    (earliest, { enrolment: e, price }) =>
      price && (price.basis === 'pack' || price.freeTrialLessons > 0) && e.startDate < earliest
        ? e.startDate
        : earliest,
    period.startDate,
  );
  const lessons = await classes.lessonDates(ctx, classIds, {
    startDate: from,
    endDate: period.endDate,
  });
  await ctx.setProgress(40);

  const taxOf = new Map(taxRates.map((rate) => [rate.id, rate]));
  const skipped: InvoiceRunResult['skipped'] = [];
  let alreadyInvoiced = 0;
  const drafts = new Map<string, Draft>();

  for (const { enrolment: e, price } of priced) {
    const skip = (reason: InvoiceSkipReason) =>
      skipped.push({ enrolmentId: e.id, studentId: e.studentId, classId: e.classId, reason });
    const familyId = familyOf.get(e.studentId)!;
    const family = families.get(familyId)!;
    if (input.branchIds && !input.branchIds.includes(family.branchId)) {
      skip('other_branch');
      continue;
    }
    const earlier = invoiced.filter((line) => line.enrolmentId === e.id);
    const line = earlier.find((l) => l.periodKey === key);
    if (line) {
      // A line this job wrote on an earlier try isn't one a run before it made.
      if (line.jobId !== ctx.jobId) alreadyInvoiced++;
      continue;
    }
    if (!price) {
      skip('no_price');
      continue;
    }
    if (price.price.currency !== org.currency) {
      skip('currency_mismatch');
      continue;
    }

    const charge = chargeFor({
      price,
      period,
      enrolment: e,
      lessonDates: lessons.get(e.classId) ?? [],
      packLessonsBought: earlier
        .filter((l) => l.basis === 'pack')
        .reduce((sum, l) => sum + l.lessons, 0),
      paidPeriods: earlier
        .filter((l) => l.basis !== 'pack')
        .map((l) => ({ startDate: l.periodStart, endDate: l.periodEnd })),
    });
    if (typeof charge === 'string') {
      skip(charge);
      continue;
    }
    const rate = price.taxRateId === null ? null : taxOf.get(price.taxRateId);
    if (rate === undefined) throw new Error(`Tax rate ${price.taxRateId} not found`);
    const amounts = withTax(charge.amount, rate);

    let draft = drafts.get(familyId);
    if (!draft) {
      draft = {
        invoice: {
          id: newId('invoice'),
          orgId: ctx.orgId,
          familyId,
          status: 'draft',
          termId: input.termId,
          month: input.month,
          periodStart: period.startDate,
          periodEnd: period.endDate,
          currency: org.currency,
          subtotalAmount: 0,
          taxAmount: 0,
          totalAmount: 0,
          bankReference: family.bankReference,
          dueDate: input.dueDate,
          notes: null,
          jobId: ctx.jobId,
        },
        lines: [],
      };
      drafts.set(familyId, draft);
    }
    draft.invoice.subtotalAmount += amounts.subtotal;
    draft.invoice.taxAmount += amounts.tax;
    draft.invoice.totalAmount += amounts.total;
    draft.lines.push({
      id: newId('invoiceLine'),
      orgId: ctx.orgId,
      invoiceId: draft.invoice.id,
      enrolmentId: e.id,
      studentId: e.studentId,
      classId: e.classId,
      periodKey: key,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      basis: charge.basis,
      unitAmount: charge.unitAmount,
      quantity: charge.quantity,
      lessons: charge.lessons,
      periodLessons: charge.periodLessons,
      freeLessons: charge.freeLessons,
      priceSource: price.source,
      priceRuleId: price.priceRuleId,
      priceOverridden: price.overridden,
      taxRateId: rate?.id ?? null,
      taxName: rate?.name ?? null,
      taxRateBps: rate?.rateBps ?? null,
      taxInclusive: rate?.inclusive ?? null,
      subtotalAmount: amounts.subtotal,
      taxAmount: amounts.tax,
      totalAmount: amounts.total,
    });
  }

  const made = [...drafts.values()];
  if (made.length > 0) {
    const lines = made.flatMap((draft) => draft.lines);
    await repo.insertInvoices(
      ctx,
      made.map((draft) => draft.invoice),
      lines,
      {
        action: 'invoice.generated',
        entityType: 'job',
        entityId: ctx.jobId,
        after: {
          termId: input.termId,
          month: input.month,
          invoices: made.length,
          lines: lines.length,
          total: made.reduce((sum, draft) => sum + draft.invoice.totalAmount, 0),
          currency: org.currency,
        },
      },
    );
  }
  await ctx.setProgress(90);

  const totals = await repo.generatedBy(ctx, ctx.jobId);
  return {
    termId: input.termId,
    month: input.month,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    invoices: totals.invoices,
    lines: totals.lines,
    total: { amount: totals.total, currency: org.currency },
    alreadyInvoiced,
    skipped,
  };
}
