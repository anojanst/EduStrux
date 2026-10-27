import type { Clash, Holiday, Session, Term } from '@edustrux/shared';
import { addDays, eachDate, weekday } from '@edustrux/shared/dates';
import { Check, ChevronRight, MapPin, User } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { markedCount } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { classColour } from '../../lib/people';
import {
  holidayOn,
  hourBounds,
  layoutLanes,
  minutes,
  monthEnd,
  monthStart,
  termEdge,
  type ViewBy,
} from '../../lib/timetable';

/** Height of an hour on the day grid. */
const HOUR_PX = 60;
/** Lessons a month cell lists before "+n more". */
const MONTH_LINES = 3;

type Format = ReturnType<typeof useFormat>;

/** What every view needs besides its lessons. */
export type CalendarProps = {
  sessions: Session[];
  clashes: Map<string, Clash[]>;
  holidays: Holiday[];
  terms: Term[];
  /** The time now in the org, "HH:MM", for the line across today. */
  now: string;
  onOpen: (session: Session) => void;
};

/** A class's colour, lightened for a lesson block's fill and border. */
function tints(classId: string): CSSProperties {
  const colour = classColour(classId);
  return {
    background: `color-mix(in srgb, ${colour} 9%, white)`,
    borderColor: `color-mix(in srgb, ${colour} 28%, white)`,
    borderLeftColor: colour,
  };
}

/** Whether a lesson has begun, so its attendance is due. */
const due = (session: Session, today: string, now: string) =>
  session.date < today || (session.date === today && session.startTime <= now);

/** "Moved from Thu 4:00", or where and with whom. */
function lessonMeta(session: Session, format: Format) {
  if (session.movedFrom) {
    return t('people.lesson.moved', {
      when: `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`,
    });
  }
  return [session.roomName, session.teacherName].filter(Boolean).join(' · ');
}

/**
 * The one thing a lesson flags, most urgent first: cancelled, a clash, moved, then whether its
 * attendance is marked once it has begun. Teachers' and staff's lessons carry `attendance`.
 * `compact` leaves the words out of the attendance flag, for a narrow block.
 */
function lessonFlag(
  session: Session,
  clashing: boolean,
  today: string,
  now: string,
  compact = false,
) {
  if (session.status === 'cancelled')
    return <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>;
  if (clashing) return <Badge tone="danger">{t('timetable.clash')}</Badge>;
  if (session.movedFrom) return <Badge tone="warning">{t('timetable.moved')}</Badge>;
  if (!session.attendance || !due(session, today, now)) return null;
  return markedCount(session) > 0 ? (
    <span className="flex items-center gap-0.5 text-meta whitespace-nowrap text-success">
      <Check className="size-3.5" aria-hidden />
      {compact ? null : t('timetable.marked')}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-meta whitespace-nowrap text-warning">
      <span aria-hidden className="size-[7px] rounded-full bg-warning" />
      {compact ? null : t('timetable.notMarked')}
    </span>
  );
}

function lessonLabel(session: Session, format: Format, flag: string) {
  return [
    session.className,
    `${format.day(session.date)} ${format.timeRange(session.startTime, session.endTime)}`,
    lessonMeta(session, format),
    flag,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The plain words of a lesson's flag, for its accessible name. */
function flagWords(session: Session, clashing: boolean, today: string, now: string) {
  if (session.status === 'cancelled') return t('people.lesson.cancelled');
  if (clashing) return t('timetable.clash');
  if (session.movedFrom) return t('timetable.moved');
  if (!session.attendance || !due(session, today, now)) return '';
  return markedCount(session) > 0 ? t('timetable.marked') : t('timetable.notMarked');
}

// ── Day and week: a time grid ───────────────────────────────────────────────

type Column = { key: string; date: string; head: ReactNode; sessions: Session[] };

/** Week view: Monday to Sunday, with today tinted and holidays hatched. */
export function WeekView({ from, ...props }: CalendarProps & { from: string }) {
  const format = useFormat();
  const columns: Column[] = eachDate(from, addDays(from, 6)).map((date) => {
    const edge = termEdge(props.terms, date);
    const holiday = holidayOn(props.holidays, date);
    return {
      key: date,
      date,
      sessions: props.sessions.filter((s) => s.date === date),
      head: (
        <>
          <span className="text-meta text-muted uppercase">{format.weekday(weekday(date))}</span>
          <b className="text-body font-semibold tabular-nums">{Number(date.slice(8))}</b>
          {holiday ? (
            <span className="absolute bottom-0.5 max-w-full truncate px-1">
              <Badge>{holiday.name}</Badge>
            </span>
          ) : edge ? (
            <small className="absolute bottom-0.5 max-w-full truncate px-1 text-meta text-brand">
              {t(edge.edge === 'starts' ? 'timetable.term.starts' : 'timetable.term.ends', {
                term: edge.term.name,
              })}
            </small>
          ) : null}
        </>
      ),
    };
  });
  return <TimeGrid columns={columns} headHeight={62} {...props} />;
}

/**
 * Day view: a column per room (or per teacher), the rooms and teachers that have a lesson that
 * day. Viewing one student's timetable, a single column.
 */
export function DayView({ date, by, ...props }: CalendarProps & { date: string; by: ViewBy }) {
  const groups = new Map<string, { name: string; sessions: Session[] }>();
  for (const s of props.sessions.filter((x) => x.date === date)) {
    const key =
      by === 'student' ? 'all' : by === 'teacher' ? (s.teacherId ?? '') : (s.roomId ?? '');
    const name =
      by === 'student'
        ? ''
        : by === 'teacher'
          ? (s.teacherName ?? t('timetable.noTeacher'))
          : (s.roomName ?? t('timetable.noRoom'));
    const group = groups.get(key) ?? { name, sessions: [] };
    group.sessions.push(s);
    groups.set(key, group);
  }
  const Icon = by === 'teacher' ? User : MapPin;
  const sorted = [...groups].sort(([a, x], [b, y]) =>
    // The lessons with no room (or teacher) go last.
    a === '' ? 1 : b === '' ? -1 : x.name.localeCompare(y.name, undefined, { numeric: true }),
  );
  const columns: Column[] = sorted.length
    ? sorted.map(([key, group]) => ({
        key: key || 'none',
        date,
        sessions: group.sessions,
        head: group.name ? (
          <span className="flex min-w-0 items-center gap-1.5 px-2 text-label font-semibold">
            <Icon className="size-[15px] shrink-0" aria-hidden />
            <span className="truncate">{group.name}</span>
          </span>
        ) : null,
      }))
    : [{ key: 'empty', date, sessions: [], head: null }];
  return <TimeGrid columns={columns} headHeight={52} resource {...props} />;
}

function TimeGrid({
  columns,
  headHeight,
  resource = false,
  sessions,
  clashes,
  holidays,
  now,
  onOpen,
}: CalendarProps & { columns: Column[]; headHeight: number; resource?: boolean }) {
  const format = useFormat();
  const hours = hourBounds(sessions);
  const height = (hours.end - hours.start) * HOUR_PX;
  const top = (time: string) => ((minutes(time) - hours.start * 60) / 60) * HOUR_PX;
  const nowTop = top(now);
  const showNow = nowTop >= 0 && nowTop <= height;
  // Resource columns stay readable: a few fill the width, many scroll sideways.
  const template = `58px repeat(${columns.length}, minmax(${resource ? 160 : 96}px, 1fr))`;
  const lines = `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX / 2 - 1}px, var(--grid-line) ${HOUR_PX / 2 - 1}px, var(--grid-line) ${HOUR_PX / 2}px)`;

  return (
    <Card flush className="overflow-x-auto">
      <div className="min-w-fit">
        <div
          className="grid border-b border-border"
          style={{ gridTemplateColumns: template, height: headHeight }}
        >
          <div className="flex items-center justify-center text-meta font-semibold text-muted">
            {resource ? t('timetable.time') : null}
          </div>
          {columns.map((col) => (
            <div
              key={col.key}
              className={cn(
                'relative flex min-w-0 items-center justify-center gap-1.5 border-l border-border',
                !resource && col.date === format.today && 'bg-brand-soft text-brand',
              )}
            >
              {col.head}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: template, height }}>
          {/* The hours read 24-hour, as in the design, so each fits the narrow gutter. */}
          <div className="relative bg-[#fafbfb]" aria-hidden>
            {Array.from({ length: hours.end - hours.start }, (_, i) => (
              <span
                key={i}
                className="block border-b border-border pt-[5px] pr-1.5 text-right text-meta text-subtle tabular-nums"
                style={{ height: HOUR_PX }}
              >
                {`${hours.start + i}:00`}
              </span>
            ))}
          </div>
          {columns.map((col) => {
            const today = col.date === format.today;
            const holiday = !resource && holidayOn(holidays, col.date);
            const places = layoutLanes(col.sessions);
            return (
              <div
                key={col.key}
                className={cn(
                  'relative border-l border-border',
                  today && !resource
                    ? 'bg-brand-soft [--grid-line:#d9e9e8]'
                    : 'bg-surface [--grid-line:var(--border)]',
                )}
                style={{
                  backgroundImage: holiday
                    ? `repeating-linear-gradient(135deg, transparent, transparent 7px, rgba(102,116,125,.06) 7px, rgba(102,116,125,.06) 9px), ${lines}`
                    : lines,
                  backgroundColor: holiday ? 'var(--canvas)' : undefined,
                }}
              >
                {today && showNow ? (
                  <i
                    aria-hidden
                    className="absolute inset-x-0 z-[3] h-0.5 bg-brand not-italic"
                    style={{ top: nowTop }}
                  >
                    <span className="absolute -top-4 right-0.5 text-meta text-brand">
                      {t('timetable.now')}
                    </span>
                  </i>
                ) : null}
                {col.sessions.map((s) => {
                  const place = places.get(s.id) ?? { lane: 0, lanes: 1 };
                  const clashing = clashes.has(s.id);
                  const y = top(s.startTime);
                  const h = Math.max(24, top(s.endTime) - y);
                  const words = flagWords(s, clashing, format.today, now);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onOpen(s)}
                      aria-label={lessonLabel(s, format, words)}
                      title={lessonLabel(s, format, words)}
                      className={cn(
                        'absolute z-[2] overflow-hidden rounded-md border border-l-[3px] p-[5px] text-left text-text transition-[filter] duration-150 hover:brightness-[0.97]',
                        s.status === 'cancelled' && 'opacity-70',
                        clashing && 'outline-2 -outline-offset-1 outline-danger',
                      )}
                      style={{
                        ...tints(s.classId),
                        top: y,
                        height: h,
                        left: `calc(${(place.lane / place.lanes) * 100}% + 3px)`,
                        width: `calc(${100 / place.lanes}% - 6px)`,
                      }}
                    >
                      <b
                        className={cn(
                          'block truncate text-meta font-semibold',
                          s.status === 'cancelled' && 'line-through',
                        )}
                      >
                        {s.className}
                      </b>
                      <span className="block truncate text-meta tabular-nums">
                        {format.timeRange(s.startTime, s.endTime)}
                      </span>
                      <small className="block truncate text-meta text-muted">
                        {lessonMeta(s, format)}
                      </small>
                      <span
                        className="absolute right-1 bottom-[3px] rounded pl-1"
                        style={{ background: 'inherit' }}
                      >
                        {/* Side by side, a lane only has room for the tick or the dot. */}
                        {lessonFlag(s, clashing, format.today, now, place.lanes > 1)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ── Month ───────────────────────────────────────────────────────────────────

/** Month view: whole weeks, up to three lessons a day, and "+n more" to open the day. */
export function MonthView({
  date,
  from,
  to,
  sessions,
  holidays,
  onOpen,
  onDay,
}: CalendarProps & { date: string; from: string; to: string; onDay: (date: string) => void }) {
  const format = useFormat();
  const first = monthStart(date);
  const last = monthEnd(date);
  const days = eachDate(from, to);
  return (
    <Card flush className="overflow-hidden">
      <div className="grid grid-cols-7">
        {days.slice(0, 7).map((d) => (
          <div
            key={d}
            className="grid h-10 place-items-center border-b border-border bg-[#fafbfb] text-meta font-semibold text-muted"
          >
            {format.weekday(weekday(d))}
          </div>
        ))}
        {days.map((d, i) => {
          const list = sessions.filter((s) => s.date === d);
          const holiday = holidayOn(holidays, d);
          const outside = d < first || d > last;
          return (
            <div
              key={d}
              className={cn(
                'relative min-h-[130px] min-w-0 border-b border-border p-2',
                i % 7 !== 6 && 'border-r',
                outside && 'bg-[#fafbfb]',
              )}
              style={
                holiday
                  ? {
                      backgroundColor: 'var(--canvas)',
                      backgroundImage:
                        'repeating-linear-gradient(135deg, transparent, transparent 7px, rgba(102,116,125,.06) 7px, rgba(102,116,125,.06) 9px)',
                    }
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                aria-label={format.dayLong(d)}
                className={cn(
                  'grid size-6 place-items-center rounded-full text-meta font-semibold tabular-nums hover:bg-canvas',
                  outside ? 'text-subtle' : 'text-text',
                  d === format.today && 'bg-brand text-white hover:bg-brand-hover',
                )}
              >
                {Number(d.slice(8))}
              </button>
              {holiday ? (
                <span className="absolute top-1.5 right-1.5 max-w-[70%] truncate">
                  <Badge>{holiday.name}</Badge>
                </span>
              ) : null}
              {list.slice(0, MONTH_LINES).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpen(s)}
                  className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 rounded text-left text-meta hover:bg-canvas"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: classColour(s.classId) }}
                  />
                  <span className="shrink-0 text-muted tabular-nums">
                    {format.time(s.startTime)}
                  </span>
                  <span
                    className={cn(
                      'truncate',
                      s.status === 'cancelled' && 'text-muted line-through',
                    )}
                  >
                    {s.className}
                  </span>
                </button>
              ))}
              {list.length > MONTH_LINES ? (
                <button
                  type="button"
                  onClick={() => onDay(d)}
                  className="mt-1 text-meta font-medium text-brand hover:underline"
                >
                  {t('timetable.more', { n: list.length - MONTH_LINES })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Phone ───────────────────────────────────────────────────────────────────

/** On phones: a strip of the week's days, then the chosen day's lessons as rows. */
export function PhoneAgenda({
  date,
  onDate,
  sessions,
  clashes,
  now,
  onOpen,
  empty,
}: CalendarProps & { date: string; onDate: (date: string) => void; empty: ReactNode }) {
  const format = useFormat();
  const monday = addDays(date, 1 - weekday(date));
  const list = sessions.filter((s) => s.date === date);
  return (
    <div className="-mx-4">
      <div className="grid grid-cols-7 border-b border-border px-2.5 pb-3">
        {eachDate(monday, addDays(monday, 6)).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDate(d)}
            aria-pressed={d === date}
            aria-label={format.dayLong(d)}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-muted',
              d === date && 'bg-brand-soft text-brand',
            )}
          >
            <span className="text-meta">{format.weekday(weekday(d)).slice(0, 1)}</span>
            <b className="text-label font-semibold tabular-nums">{Number(d.slice(8))}</b>
          </button>
        ))}
      </div>
      <p className="m-4 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
        {format.dayLong(date)}
      </p>
      {list.length === 0 ? (
        <div className="px-4">{empty}</div>
      ) : (
        <ul className="divide-y divide-border border-y border-border bg-surface">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s)}
                className="grid min-h-[78px] w-full grid-cols-[66px_1fr_auto_20px] items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <span
                  className="flex flex-col border-l-[3px] pl-2"
                  style={{ borderColor: classColour(s.classId) }}
                >
                  <b className="text-label font-semibold tabular-nums">
                    {format.time(s.startTime)}
                  </b>
                  <small className="text-meta text-muted tabular-nums">
                    {format.time(s.endTime)}
                  </small>
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <b
                    className={cn(
                      'truncate text-label font-semibold',
                      s.status === 'cancelled' && 'text-muted line-through',
                    )}
                  >
                    {s.className}
                  </b>
                  <small className="truncate text-meta text-muted">{lessonMeta(s, format)}</small>
                </span>
                <span>{lessonFlag(s, clashes.has(s.id), format.today, now)}</span>
                <ChevronRight className="size-5 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
