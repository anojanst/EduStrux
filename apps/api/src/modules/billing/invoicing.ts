import type { InvoiceSkipReason, PriceBasis } from '@edustrux/shared';
import type { ResolvedPrice } from './pricing';

/** Local dates, both included. */
export type DateRange = { startDate: string; endDate: string };

/** The tax a price is charged with. */
export type Tax = { rateBps: number; inclusive: boolean };

/** What one enrolment is charged for one period, before tax is worked out. */
export type Charge = {
  basis: PriceBasis;
  /** The price for one `basis`. */
  unitAmount: number;
  /** Lessons for per_lesson, packs for pack, 1 for per_term and per_month. */
  quantity: number;
  /** The lessons the charge pays for. For a pack, the lessons its packs hold. */
  lessons: number;
  /** The lessons the class holds in the period. null for a pack. */
  periodLessons: number | null;
  /** The enrolment's free-trial lessons that fell in the period. */
  freeLessons: number;
  /** In minor units: `quantity` × `unitAmount`, with a term or month price cut down pro rata. */
  amount: number;
};

export type ChargeInput = {
  price: Pick<ResolvedPrice, 'basis' | 'price' | 'packLessons' | 'freeTrialLessons'>;
  period: DateRange;
  /** The dates the enrolment covers. A null end = until the class ends. */
  enrolment: { startDate: string; endDate: string | null };
  /**
   * The class's lesson dates in order, up to the end of the period. They must go back to the
   * start of the period, and to the enrolment's first day when the price is a pack or has a
   * free trial, since both count lessons from there.
   */
  lessonDates: string[];
  /** For a pack: the lessons the packs already invoiced for this enrolment hold. */
  packLessonsBought?: number;
  /** For a pack: the periods this enrolment was invoiced for on another basis. */
  paidPeriods?: DateRange[];
};

/** `n / d` to the nearest whole number, halves up. Both are whole numbers, `n` not negative. */
export const divRound = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

const within = (date: string, range: DateRange) => date >= range.startDate && date <= range.endDate;

/**
 * What an enrolment owes for a period, or why it owes nothing.
 *
 * Lessons are the ones the class holds on the dates the enrolment covers. A free trial is the
 * enrolment's first lessons, whichever period they fall in. A term or month price is charged pro
 * rata by lessons: the lessons charged out of the lessons the class holds in the period. A
 * per-lesson price is charged for each lesson. A pack is invoiced up front: enough packs to
 * cover every lesson up to the end of the period that the packs already invoiced don't.
 */
export function chargeFor(input: ChargeInput): Charge | InvoiceSkipReason {
  const { price, period, enrolment } = input;
  const unitAmount = price.price.amount;

  // The enrolment's own lessons up to the end of the period, oldest first.
  const own = input.lessonDates.filter(
    (date) =>
      date >= enrolment.startDate &&
      date <= period.endDate &&
      (enrolment.endDate === null || date <= enrolment.endDate),
  );
  const covered = own.filter((date) => within(date, period)).length;
  if (covered === 0) return 'no_lessons';
  if (unitAmount === 0) return 'free';

  const trial = Math.min(price.freeTrialLessons, own.length);
  const freeLessons = Math.max(0, trial - (own.length - covered));
  const charged = covered - freeLessons;

  if (price.basis === 'pack') {
    const size = price.packLessons ?? 1;
    const paid = input.paidPeriods ?? [];
    const used = own.slice(trial).filter((date) => !paid.some((p) => within(date, p))).length;
    const short = used - (input.packLessonsBought ?? 0);
    if (short <= 0) return charged === 0 ? 'free_trial' : 'pack_covers';
    const packs = Math.ceil(short / size);
    return {
      basis: 'pack',
      unitAmount,
      quantity: packs,
      lessons: packs * size,
      periodLessons: null,
      freeLessons,
      amount: packs * unitAmount,
    };
  }

  if (charged === 0) return 'free_trial';
  const periodLessons = input.lessonDates.filter((date) => within(date, period)).length;
  const perLesson = price.basis === 'per_lesson';
  const amount = perLesson ? charged * unitAmount : divRound(unitAmount * charged, periodLessons);
  if (amount === 0) return 'free';
  return {
    basis: price.basis,
    unitAmount,
    quantity: perLesson ? charged : 1,
    lessons: charged,
    periodLessons,
    freeLessons,
    amount,
  };
}

/**
 * Splits a charge into what it is before tax, the tax, and their sum. An inclusive rate is
 * already inside the amount; an exclusive one is added to it. Tax is rounded per charge, halves
 * up.
 */
export function withTax(amount: number, tax: Tax | null) {
  if (!tax) return { subtotal: amount, tax: 0, total: amount };
  if (tax.inclusive) {
    const part = divRound(amount * tax.rateBps, 10_000 + tax.rateBps);
    return { subtotal: amount - part, tax: part, total: amount };
  }
  const added = divRound(amount * tax.rateBps, 10_000);
  return { subtotal: amount, tax: added, total: amount + added };
}

/** A calendar month (`2026-11`) as its first and last day. */
export function monthRange(month: string): DateRange {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
}
