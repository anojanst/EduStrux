// Lessons store a local date and time ("2026-10-14", "16:00") plus the org's IANA timezone, so a
// 4 pm class stays at 4 pm across daylight-saving changes. Event timestamps are ISO UTC.
// These helpers convert between the two with Intl alone (Temporal isn't available everywhere),
// and do calendar maths on plain YYYY-MM-DD strings so a date never shifts with the runtime's
// own timezone.

import type { DateFormat, Org } from './schemas/orgs';

const DAY_MS = 86_400_000;

export type LocalDateTime = { date: string; time: string; hour: number };
export type OrgFormat = Pick<Org, 'timezone' | 'locale' | 'dateFormat'>;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "YYYY-MM-DD" parsed by hand, never through Date parsing. Throws a RangeError if invalid. */
export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
      return { year, month, day };
    }
  }
  throw new RangeError(`Not a valid date: "${date}"`);
}

function parseLocalTime(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError(`Not a valid time: "${time}"`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// Calendar maths works on whole days since 1970-01-01, which has no timezone in it.
const toDayNumber = (date: string) => {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};
const fromDayNumber = (days: number) => new Date(days * DAY_MS).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/** Days from `from` to `to`: ("2026-10-05", "2026-10-12") → 7. */
export function diffDays(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(date: string): number {
  return new Date(toDayNumber(date) * DAY_MS).getUTCDay() || 7;
}

/** Every date from `start` to `end`, inclusive. Empty when `end` is before `start`. */
export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = toDayNumber(start), last = toDayNumber(end); d <= last; d++) {
    dates.push(fromDayNumber(d));
  }
  return dates;
}

const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock reading of an instant in a timezone. */
function wallClock(epochMs: number, timeZone: string) {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23', // without it, some engines print midnight as hour 24
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    wallClockFormats.set(timeZone, format);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of format.formatToParts(epochMs)) parts[part.type] = Number(part.value);
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** The timezone's offset from UTC at an instant, in ms (positive east of UTC). */
function offsetAt(epochMs: number, timeZone: string): number {
  const w = wallClock(epochMs, timeZone);
  const wallMs = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallMs - Math.floor(epochMs / 1000) * 1000;
}

/**
 * A local date and time in a timezone to an ISO UTC instant:
 * ("2026-10-14", "16:00", "Pacific/Auckland") → "2026-10-14T03:00:00.000Z".
 *
 * Daylight saving follows Temporal's "compatible" rule (D-016): a time skipped when the clocks go
 * forward moves forward by the length of the gap (02:30 → 03:30), and a time that happens twice
 * when the clocks go back resolves to the earlier of the two.
 */
export function localToUtc(date: string, time: string, timeZone: string): string {
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseLocalTime(time);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets a day either side. A timezone changes its offset at most once in that window.
  const before = offsetAt(wallMs - DAY_MS, timeZone);
  const after = offsetAt(wallMs + DAY_MS, timeZone);
  const matches = [wallMs - before, wallMs - after].filter(
    (ms) => ms + offsetAt(ms, timeZone) === wallMs,
  );
  // No match means the time is in a gap: read it with the offset from before the gap.
  const instant = matches.length ? Math.min(...matches) : wallMs - before;
  return new Date(instant).toISOString();
}

/** An instant as local date and time in a timezone, with the hour as a number for crons. */
export function utcToLocal(instant: string | Date, timeZone: string): LocalDateTime {
  const epochMs = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(epochMs)) throw new RangeError(`Not a valid instant: "${String(instant)}"`);
  const w = wallClock(epochMs, timeZone);
  return {
    date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
    hour: w.hour,
  };
}

/** The local date and time right now in a timezone, e.g. for crons that act at an org's hour. */
export function localNow(timeZone: string, now: Date = new Date()): LocalDateTime {
  return utcToLocal(now, timeZone);
}

/** A date in the org's date format: "14/10/2026", "10/14/2026" or "2026-10-14". */
export function formatDate(date: string, dateFormat: DateFormat): string {
  const { year, month, day } = parseLocalDate(date);
  const [y, m, d] = [String(year), pad(month), pad(day)];
  switch (dateFormat) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`;
  }
}

/** A local time in the locale's clock: "16:00" (en-GB), "4:00 pm" (en-NZ), "4:00 PM" (en-US). */
export function formatTime(time: string, locale: string): string {
  const { hour, minute } = parseLocalTime(time);
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(
    Date.UTC(2000, 0, 1, hour, minute),
  );
}

/** An instant as the org's local date and time, e.g. "14/10/2026 4:00 pm". */
export function formatTimestamp(instant: string | Date, org: OrgFormat): string {
  const local = utcToLocal(instant, org.timezone);
  return `${formatDate(local.date, org.dateFormat)} ${formatTime(local.time, org.locale)}`;
}
