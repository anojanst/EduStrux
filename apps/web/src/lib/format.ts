import { diffDays, formatDate, formatTime, localNow, utcToLocal } from '@edustrux/shared/dates';
import { formatMoney, type MoneyValue } from '@edustrux/shared/money';
import { useOrg } from './org';

/** Until the org's settings load, dates read as the browser's locale would. */
const FALLBACK = {
  locale: 'en-NZ',
  dateFormat: 'DD/MM/YYYY' as const,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/**
 * Money, dates and times in the org's currency, locale, date format and timezone (ui-design.md
 * §7). Lesson dates read as words ("Mon 2 Mar"); record dates in the org's date format.
 */
export function useFormat() {
  const { org } = useOrg();
  const { locale, dateFormat, timezone } = org ?? FALLBACK;
  const today = localNow(timezone).date;
  const words = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const short = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const monthOnly = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  const monthYear = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return {
    today,
    money: (money: MoneyValue) => formatMoney(money, locale),
    date: (date: string) => formatDate(date, dateFormat),
    /** The day an event happened (`issuedAt`), in the org's timezone and date format. */
    stamp: (instant: string) => formatDate(utcToLocal(instant, timezone).date, dateFormat),
    /** "Mon 2 Mar": a lesson's day. */
    day: (date: string) => words.format(new Date(`${date}T00:00:00Z`)),
    time: (time: string) => formatTime(time, locale),
    timeRange: (start: string, end: string) =>
      `${formatTime(start, locale)}–${formatTime(end, locale)}`,
    /** Whole years from a date of birth to today. */
    age: (dateOfBirth: string) => ageOn(dateOfBirth, today),
    daysUntil: (date: string) => diffDays(today, date),
    weekday: (weekday: number) => weekdayName(weekday, locale),
    /** "Monday" for ISO weekday 1. */
    weekdayLong: (weekday: number) => weekdayName(weekday, locale, 'long'),
    /** "Tuesday, 28 October": a lesson's day in full. */
    dayLong: (date: string) => long.format(new Date(`${date}T00:00:00Z`)),
    /** "28 October": a day without its weekday, as a week's heading names its Monday. */
    dayMonth: (date: string) => dayMonth.format(new Date(`${date}T00:00:00Z`)),
    /** "27 Jan": one end of a term or a holiday. */
    dayShort: (date: string) => short.format(new Date(`${date}T00:00:00Z`)),
    /** "November" for the month `2026-11`, under a heading that already names the year. */
    monthName: (month: string) => monthOnly.format(new Date(`${month}-01T00:00:00Z`)),
    /** "November 2026" for the billing month `2026-11`. */
    month: (month: string) => monthYear.format(new Date(`${month}-01T00:00:00Z`)),
  };
}

export function ageOn(dateOfBirth: string, today: string) {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** "Mon" (or "Monday") for ISO weekday 1, in the locale. */
export function weekdayName(
  weekday: number,
  locale = FALLBACK.locale,
  width: 'short' | 'long' = 'short',
) {
  if (weekday < 1 || weekday > 7) return '';
  // 2024-01-01 was a Monday, so day n of that week is ISO weekday n.
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(
    Date.UTC(2024, 0, weekday),
  );
}
