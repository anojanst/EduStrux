// The weekly schedule as plain date maths: no database, no clock. Dates and times are local
// (`YYYY-MM-DD`, `HH:MM`), which compare correctly as text.

import { eachDate, weekday, type ScheduleSlot, type SetSchedule } from '@edustrux/shared';

export type DateRange = { startDate: string; endDate: string };
export type Occurrence = { date: string; startTime: string; endTime: string };
/** A local date and time, e.g. "now" in the org's timezone. */
export type LocalMoment = { date: string; time: string };

/** Whether a lesson is still to come. One that has started is never changed by the generator. */
export const notStarted = (lesson: { date: string; startTime: string }, now: LocalMoment) =>
  lesson.date > now.date || (lesson.date === now.date && lesson.startTime > now.time);

/** `HH:MM` plus some minutes, or null when that runs past midnight. */
export function addMinutes(time: string, minutes: number): string | null {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const total = hour * 60 + minute + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Turns the request's slots into complete ones, in weekday then start-time order. A missing end
 * time comes from the course's lesson length. Returns field errors (keyed like the request body)
 * when an end time can't be worked out or two slots on the same day overlap.
 */
export function resolveSlots(
  input: SetSchedule['slots'],
  durationMinutes: number | null,
): { slots: ScheduleSlot[] } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const resolved = input.map((slot, index) => {
    let endTime = slot.endTime ?? null;
    if (endTime === null) {
      if (durationMinutes === null) {
        errors[`slots.${index}.endTime`] = ['Required: the course has no durationMinutes'];
      } else {
        endTime = addMinutes(slot.startTime, durationMinutes);
        if (endTime === null) errors[`slots.${index}.endTime`] = ['Runs past midnight'];
      }
    }
    return { index, weekday: slot.weekday, startTime: slot.startTime, endTime: endTime ?? '' };
  });
  if (Object.keys(errors).length > 0) return { errors };

  resolved.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  resolved.forEach((slot, i) => {
    const previous = resolved[i - 1];
    if (previous && previous.weekday === slot.weekday && slot.startTime < previous.endTime) {
      errors[`slots.${slot.index}`] = ['Overlaps another slot on the same day'];
    }
  });
  if (Object.keys(errors).length > 0) return { errors };

  return { slots: resolved.map(({ index: _index, ...slot }) => slot) };
}

/**
 * Every lesson the weekly slots produce from `from` to `to` (both included), in date then
 * start-time order. A date inside any closed range gets none.
 */
export function occurrences(
  slots: ScheduleSlot[],
  from: string,
  to: string,
  closed: DateRange[],
): Occurrence[] {
  if (slots.length === 0) return [];
  const lessons: Occurrence[] = [];
  for (const date of eachDate(from, to)) {
    if (closed.some((range) => range.startDate <= date && date <= range.endDate)) continue;
    const day = weekday(date);
    for (const slot of slots) {
      if (slot.weekday === day) {
        lessons.push({ date, startTime: slot.startTime, endTime: slot.endTime });
      }
    }
  }
  return lessons;
}
