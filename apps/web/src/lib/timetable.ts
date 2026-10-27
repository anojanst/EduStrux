import type { Clash, Holiday, Session, Term } from '@edustrux/shared';
import { addDays, parseLocalDate } from '@edustrux/shared/dates';
import { weekOf } from './classes';

export const VIEWS = ['day', 'week', 'month'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_BYS = ['branch', 'room', 'teacher', 'student'] as const;
export type ViewBy = (typeof VIEW_BYS)[number];

/** The hours the day grid always shows; lessons outside them stretch it (ui-design.md §5). */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;

/** "2026-10-01": the first day of a date's month. */
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of a date's month. */
export function monthEnd(date: string) {
  const { year, month } = parseLocalDate(date);
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/**
 * The dates a view shows, both ends included: the day, its Monday-to-Sunday week, or the whole
 * weeks that hold its month (so the month grid's first and last rows are full).
 */
export function viewRange(view: View, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') {
    const from = weekOf(date);
    return { from, to: addDays(from, 6) };
  }
  const from = weekOf(monthStart(date));
  return { from, to: addDays(weekOf(monthEnd(date)), 6) };
}

/** Where the arrows go from a date: a day, a week or a month either way. */
export function stepDate(view: View, date: string, by: 1 | -1) {
  if (view === 'day') return addDays(date, by);
  if (view === 'week') return addDays(date, 7 * by);
  const { year, month } = parseLocalDate(date);
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** "16:30" as minutes from midnight. */
export function minutes(time: string) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** The first and last hour the grid shows: 7:00 to 21:00, wider when a lesson needs it. */
export function hourBounds(sessions: Pick<Session, 'startTime' | 'endTime'>[]) {
  let start = DAY_START_HOUR;
  let end = DAY_END_HOUR;
  for (const s of sessions) {
    start = Math.min(start, Math.floor(minutes(s.startTime) / 60));
    end = Math.max(end, Math.ceil(minutes(s.endTime) / 60));
  }
  return { start, end: Math.min(24, end) };
}

/**
 * Side-by-side places for lessons that overlap in one column. Lessons that overlap, directly or
 * through others, share the column's width equally; each takes the first lane free at its start.
 */
export function layoutLanes<T extends Pick<Session, 'id' | 'startTime' | 'endTime'>>(
  sessions: T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...sessions].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
  );
  const places = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: string[] = [];
  let groupEnd = '';
  const flush = () => {
    for (const item of group) places.set(item.id, { lane: item.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const s of sorted) {
    if (group.length && s.startTime >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s.startTime);
    if (lane === -1) lane = laneEnds.push(s.endTime) - 1;
    else laneEnds[lane] = s.endTime;
    group.push({ id: s.id, lane });
    groupEnd = group.length === 1 || s.endTime > groupEnd ? s.endTime : groupEnd;
  }
  flush();
  return places;
}

/** Room and teacher clashes, the ones the timetable marks: pairs, and each lesson's others. */
export function clashesBySession(clashes: Clash[]) {
  const shown = clashes.filter((c) => c.kind === 'room' || c.kind === 'teacher');
  const bySession = new Map<string, Clash[]>();
  for (const clash of shown) {
    for (const s of clash.sessions) bySession.set(s.id, [...(bySession.get(s.id) ?? []), clash]);
  }
  return { shown, bySession };
}

/** The holiday that closes a date for the branch shown, if any. */
export function holidayOn(holidays: Holiday[], date: string) {
  return holidays.find((h) => h.startDate <= date && h.endDate >= date);
}

/** "Term 4 starts" or "Term 4 ends" on a term's first or last day. */
export function termEdge(terms: Term[], date: string) {
  for (const term of terms) {
    if (term.startDate === date) return { term, edge: 'starts' as const };
    if (term.endDate === date) return { term, edge: 'ends' as const };
  }
  return null;
}
