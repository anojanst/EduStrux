import { diffDays, formatDate, formatTime, localNow } from '@edustrux/shared/dates';
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

  return {
    today,
    money: (money: MoneyValue) => formatMoney(money, locale),
    date: (date: string) => formatDate(date, dateFormat),
    /** "Mon 2 Mar": a lesson's day. */
    day: (date: string) => words.format(new Date(`${date}T00:00:00Z`)),
    time: (time: string) => formatTime(time, locale),
    timeRange: (start: string, end: string) =>
      `${formatTime(start, locale)}–${formatTime(end, locale)}`,
    /** Whole years from a date of birth to today. */
    age: (dateOfBirth: string) => ageOn(dateOfBirth, today),
    daysUntil: (date: string) => diffDays(today, date),
    weekday: (weekday: number) => weekdayName(weekday, locale),
  };
}

export function ageOn(dateOfBirth: string, today: string) {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map(
  (day) =>
    // 2024-01-01 was a Monday, so day n of that week is ISO weekday n.
    (locale: string) =>
      new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
        Date.UTC(2024, 0, day),
      ),
);

/** "Mon" for ISO weekday 1, in the locale. */
export function weekdayName(weekday: number, locale = FALLBACK.locale) {
  return WEEKDAYS[weekday - 1]?.(locale) ?? '';
}
