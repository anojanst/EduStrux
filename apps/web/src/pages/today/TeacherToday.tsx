import type { AbsenceNotice, Class, Session } from '@edustrux/shared';
import { addDays, localNow } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarCheck,
  CalendarX,
  Check,
  Clock,
  MapPin,
  MessageSquareWarning,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageError } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { markedCount, useCourseLabel } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { classColour, query, type Page } from '../../lib/people';
import { minutes } from '../../lib/timetable';
import { marksLabel } from '../classes/LessonResult';
import { useLessonAttendance } from '../classes/attendance';
import { SkeletonRows } from '../people/parts';
import { QuickAttendance } from './QuickAttendance';

/** How far back Today looks for lessons left unmarked, and how far ahead for the week. */
const LOOK_BACK_DAYS = 14;
const LOOK_AHEAD_DAYS = 7;
/** Lessons the "This week" card lists. */
const WEEK_LINES = 5;

/**
 * A teacher's home (TUI-57): the next lesson, today's lessons with one-tap attendance, what
 * needs attention, and the rest of the week. Built for a phone between lessons.
 */
export function TeacherToday({ greeting, overline }: { greeting: string; overline: string }) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const courseLabel = useCourseLabel();
  const [marking, setMarking] = useState<Session | null>(null);
  const orgId = membership.org.id;
  const today = format.today;
  const now = localNow(org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).time;
  const from = addDays(today, -LOOK_BACK_DAYS);
  const to = addDays(today, LOOK_AHEAD_DAYS);

  const sessions = useQuery({
    queryKey: ['sessions', orgId, { from, to }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(membership, `/sessions${query({ from, to, limit: 200 })}`),
        { signal },
      ),
  });
  const classes = useQuery({
    queryKey: ['classes', orgId, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<Class>>('GET', orgApiPath(membership, '/classes?limit=200'), { signal }),
    staleTime: 60_000,
  });
  const notices = useQuery({
    queryKey: ['absence-notices', orgId, { from: today, to }],
    queryFn: ({ signal }) =>
      api<Page<AbsenceNotice>>(
        'GET',
        orgApiPath(membership, `/absence-notices${query({ from: today, to, limit: 200 })}`),
        { signal },
      ),
  });

  const all = sessions.data?.data ?? [];
  const enrolled = new Map(classes.data?.data.map((c) => [c.id, c.enrolledCount]));
  const live = (s: Session) => s.status !== 'cancelled';
  const started = (s: Session) => s.date < today || (s.date === today && s.startTime <= now);
  const unmarked = (s: Session) =>
    live(s) && started(s) && s.attendance !== undefined && markedCount(s) === 0;

  const todays = all.filter((s) => s.date === today);
  const toMark = todays.filter(unmarked).length;
  const lessonsToday = todays.filter(live).length;
  const next =
    todays.find((s) => live(s) && s.endTime > now) ?? all.find((s) => live(s) && s.date > today);
  const earlier = all.filter((s) => s.date < today && unmarked(s));
  const ahead = all.filter((s) => live(s) && s.date > today);
  const away = notices.data?.data ?? [];

  const subtitle = [
    lessonsToday === 0
      ? t('today.none')
      : t(lessonsToday === 1 ? 'today.lessons.one' : 'today.lessons', { n: lessonsToday }),
    toMark ? t('today.toMark', { n: toMark }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
          {overline}
        </p>
        <h1 className="text-[24px] leading-[30px] font-normal tracking-[-0.02em] text-text sm:text-title">
          {greeting}
        </h1>
        <p className="mt-1 text-label text-muted sm:text-body">
          {sessions.isSuccess ? subtitle : ' '}
        </p>
      </header>

      {sessions.isError ? (
        <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="flex flex-col gap-5">
            {sessions.isPending ? null : next ? (
              <NextLesson
                session={next}
                course={courseLabel(next.courseId)}
                students={enrolled.get(next.classId)}
                now={now}
                onMark={() => setMarking(next)}
              />
            ) : null}

            <section>
              <div className="flex min-h-[50px] items-center justify-between gap-3">
                <h2 className="text-section font-medium text-text">{t('today.title')}</h2>
                <span className="text-meta text-muted">{format.dayLong(today)}</span>
              </div>
              <Card flush className="overflow-hidden">
                {sessions.isPending ? (
                  <SkeletonRows rows={3} />
                ) : todays.length === 0 ? (
                  <EmptyDay next={next} />
                ) : (
                  <ul className="divide-y divide-border">
                    {todays.map((s) => (
                      <LessonRow
                        key={s.id}
                        session={s}
                        students={enrolled.get(s.classId)}
                        now={now}
                        onMark={() => setMarking(s)}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          <aside className="flex flex-col gap-5">
            <Card flush className="overflow-hidden px-4">
              <div className="flex min-h-[50px] items-center">
                <h2 className="text-section font-medium text-text">{t('today.attention')}</h2>
              </div>
              {earlier.length === 0 && away.length === 0 ? (
                <p className="flex items-center gap-2 border-t border-border py-4 text-body text-muted">
                  <Check className="size-4 text-success" aria-hidden />
                  {t('today.caughtUp')}
                </p>
              ) : null}
              {earlier.length > 0 ? (
                <Attention
                  Icon={CalendarX}
                  tone="danger"
                  title={t(earlier.length === 1 ? 'today.unmarked.one' : 'today.unmarked', {
                    n: earlier.length,
                  })}
                >
                  <button
                    type="button"
                    onClick={() => setMarking(earlier[0]!)}
                    className="flex min-h-11 items-center gap-1 text-meta font-semibold text-brand hover:underline md:min-h-0"
                  >
                    {t('today.markOldest', { day: format.day(earlier[0]!.date) })}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                </Attention>
              ) : null}
              {away.length > 0 ? (
                <Attention
                  Icon={MessageSquareWarning}
                  tone="warning"
                  title={t(away.length === 1 ? 'today.away.one' : 'today.away', {
                    n: away.length,
                  })}
                >
                  <ul className="flex flex-col gap-0.5 text-meta text-muted">
                    {away.slice(0, 3).map((notice) => (
                      <li key={notice.id}>
                        {notice.studentFirstName} {notice.studentLastName} ·{' '}
                        {notice.startDate === notice.endDate
                          ? format.day(notice.startDate)
                          : `${format.day(notice.startDate)} – ${format.day(notice.endDate)}`}
                      </li>
                    ))}
                    {away.length > 3 ? (
                      <li>{t('today.awayMore', { n: away.length - 3 })}</li>
                    ) : null}
                  </ul>
                </Attention>
              ) : null}
            </Card>

            <Card flush className="hidden overflow-hidden px-4 md:block">
              <div className="flex min-h-[50px] items-center">
                <h2 className="text-section font-medium text-text">{t('today.week')}</h2>
              </div>
              {ahead.length === 0 ? (
                <p className="border-t border-border py-4 text-body text-muted">
                  {t('today.weekEmpty')}
                </p>
              ) : (
                <ul>
                  {ahead.slice(0, WEEK_LINES).map((s) => (
                    <li
                      key={s.id}
                      className="flex min-h-[50px] flex-col justify-center border-t border-border py-1.5"
                    >
                      <span className="text-meta text-muted">
                        {format.day(s.date)} {format.time(s.startTime)}
                      </span>
                      <b className="truncate text-label font-semibold text-text">{s.className}</b>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </aside>
        </div>
      )}

      {marking ? (
        <QuickAttendance key={marking.id} session={marking} onClose={() => setMarking(null)} />
      ) : null}
    </div>
  );
}

/** "in 25 min" or "in 2 h" until a lesson starts, minutes from now. */
function startsIn(wait: number) {
  return wait < 60
    ? t('today.inMinutes', { n: wait })
    : t('today.inHours', { n: Math.floor(wait / 60) });
}

/** "On now", "Next lesson · in 25 min", or the day and time of a lesson after today. */
function nextOverline(session: Session, now: string, format: ReturnType<typeof useFormat>) {
  if (session.date !== format.today) {
    return t('today.next', {
      when: `${format.day(session.date)} ${format.time(session.startTime)}`,
    });
  }
  const wait = minutes(session.startTime) - minutes(now);
  return wait <= 0 ? t('today.onNow') : t('today.next', { when: startsIn(wait) });
}

/** The lesson on now or next: where, who's expected and who's away, and taking attendance. */
function NextLesson({
  session,
  course,
  students,
  now,
  onMark,
}: {
  session: Session;
  course: string;
  students: number | undefined;
  now: string;
  onMark: () => void;
}) {
  const format = useFormat();
  const isToday = session.date === format.today;
  // Who is away comes from the lesson's roster, read only for a lesson today.
  const { roster } = useLessonAttendance(session.id, isToday);
  const away = roster.data?.records.filter((r) => r.absenceNotice).length ?? 0;

  return (
    <Card className="relative overflow-hidden">
      <i
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: classColour(session.classId) }}
      />
      <p className="mb-2 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
        {nextOverline(session, now, format)}
      </p>
      <h2 className="text-[18px] leading-6 font-semibold text-text sm:text-[20px]">
        {session.className}
      </h2>
      {course ? <p className="text-label text-muted">{course}</p> : null}
      <div className="mt-4 mb-3 grid grid-cols-2 gap-2.5 text-label text-text sm:flex sm:gap-5">
        <span className="flex items-center gap-1.5">
          <Clock className="size-4 text-muted" aria-hidden />
          {format.timeRange(session.startTime, session.endTime)}
        </span>
        {session.roomName ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4 text-muted" aria-hidden />
            {session.roomName}
          </span>
        ) : null}
      </div>
      <div className="mb-4 flex items-center justify-between gap-2.5 text-label text-text sm:justify-start">
        {students !== undefined ? (
          <span className="flex items-center gap-1.5">
            <Users className="size-4 text-muted" aria-hidden />
            {t(students === 1 ? 'today.students.one' : 'today.students', { n: students })}
          </span>
        ) : null}
        {away > 0 ? <Badge tone="warning">{t('today.awayToday', { n: away })}</Badge> : null}
      </div>
      {isToday ? (
        <Button className="w-full sm:w-auto sm:min-w-[190px] max-sm:h-12" onClick={onMark}>
          {t('today.take')}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * A lesson today: its times, class and room, then its marks or what to do about them. A teacher
 * sees how many students to expect; other staff (the staff Home, TUI-125) who teaches it. Without
 * `onMark` an unmarked lesson only says so.
 */
export function LessonRow({
  session,
  students,
  now,
  onMark,
  showTeacher = false,
}: {
  session: Session;
  students?: number;
  now: string;
  onMark?: () => void;
  showTeacher?: boolean;
}) {
  const format = useFormat();
  const cancelled = session.status === 'cancelled';
  const begun = session.startTime <= now;
  const marked = markedCount(session) > 0;
  const where = [
    session.roomName,
    showTeacher
      ? session.teacherName
      : students !== undefined
        ? t(students === 1 ? 'today.students.one' : 'today.students', { n: students })
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let state: ReactNode;
  if (cancelled) state = <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>;
  else if (marked)
    state = (
      <Badge tone="success">
        <Check className="size-3.5" aria-hidden />
        {marksLabel(session)}
      </Badge>
    );
  else if (begun && session.attendance)
    state = (
      <>
        <Badge tone="warning">{t('classes.notMarked')}</Badge>
        {onMark ? (
          <Button variant="secondary" size="sm" className="max-md:h-11" onClick={onMark}>
            {t('today.mark')}
          </Button>
        ) : null}
      </>
    );
  else if (!begun)
    state = (
      <span className="text-meta text-muted">
        {startsIn(minutes(session.startTime) - minutes(now))}
      </span>
    );

  return (
    <li className="grid min-h-[88px] grid-cols-[72px_1fr_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 md:min-h-[76px] md:grid-cols-[74px_1fr_auto] md:px-3.5">
      <span
        className="flex flex-col border-l-[3px] pl-2 whitespace-nowrap md:pl-[9px]"
        style={{ borderColor: classColour(session.classId) }}
      >
        <b className="text-label font-semibold tabular-nums">{format.time(session.startTime)}</b>
        <small className="mt-0.5 text-meta text-muted tabular-nums">
          {format.time(session.endTime)}
        </small>
      </span>
      <span className="flex min-w-0 flex-col">
        <b
          className={cn(
            'truncate text-label font-semibold text-text',
            cancelled && 'text-muted line-through',
          )}
        >
          {session.className}
        </b>
        <small className="mt-0.5 truncate text-meta text-muted">
          {session.movedFrom
            ? t('people.lesson.moved', {
                when: `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`,
              })
            : where}
        </small>
      </span>
      {state ? (
        <div className="col-span-2 col-start-2 flex items-center gap-2 md:col-span-1 md:col-start-3">
          {state}
        </div>
      ) : null}
    </li>
  );
}

/** No lessons today: say so, and when the next one is. */
function EmptyDay({ next }: { next: Session | undefined }) {
  const format = useFormat();
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <span className="grid size-[34px] place-items-center rounded-lg bg-brand-soft text-brand">
        <CalendarCheck className="size-[18px]" aria-hidden />
      </span>
      <h3 className="mt-3.5 text-section font-medium text-text">{t('today.empty')}</h3>
      {next ? (
        <p className="mt-1 text-label text-muted">
          {t('today.emptyNext', {
            when: `${format.day(next.date)} ${format.time(next.startTime)}`,
            name: next.className,
          })}
        </p>
      ) : null}
    </div>
  );
}

const tiles = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
} as const;

/** One thing that needs the teacher: an icon tile, what it is, and what to do. */
function Attention({
  Icon,
  tone,
  title,
  children,
}: {
  Icon: typeof Check;
  tone: keyof typeof tiles;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-[76px] grid-cols-[34px_1fr] items-center gap-2.5 border-t border-border py-3">
      <span className={cn('grid size-[34px] place-items-center rounded-lg', tiles[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <b className="text-label font-semibold text-text">{title}</b>
        {children}
      </div>
    </div>
  );
}
