import {
  CLASH_RANGE_DAYS,
  type Clash,
  type Class,
  type Enrolment,
  type Holiday,
  type Session,
} from '@edustrux/shared';
import { addDays } from '@edustrux/shared/dates';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ChevronLeft,
  Clock,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import {
  classKey,
  classRange,
  sortSlots,
  useClassPaths,
  useCourseLabel,
  useCourses,
  useRefreshClasses,
  useTerms,
  weekOf,
} from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  classColour,
  namesOf,
  query,
  useBranches,
  usePeoplePaths,
  type Page,
} from '../../lib/people';
import { can } from '../../lib/roles';
import { ConfirmDialog } from '../people/dialogs';
import { CardEmpty, EmptyState, SectionCard, SkeletonRows } from '../people/parts';
import { ClassDialog, ScheduleDialog } from './ClassDialog';
import { EnrolDialog, TransferDialog, WithdrawDialog } from './EnrolDialogs';
import { LessonResult } from './LessonResult';
import { StatCard, scheduleLabel } from './parts';

export function ClassPage() {
  const { membership } = useOrg();
  const { classId = '' } = useParams();
  if (!can(membership.role, 'classes:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <ClassDetail key={classId} classId={classId} />;
}

type Tab = 'students' | 'lessons' | 'schedule';
const TABS: Tab[] = ['students', 'lessons', 'schedule'];

function ClassDetail({ classId }: { classId: string }) {
  const { membership } = useOrg();
  const format = useFormat();
  const navigate = useNavigate();
  const paths = useClassPaths();
  const refresh = useRefreshClasses();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab)
    ? (params.get('tab') as Tab)
    : 'students';
  const [open, setOpen] = useState<'edit' | 'delete' | 'schedule' | null>(null);
  const canWrite = can(membership.role, 'classes:write');
  const courseLabel = useCourseLabel();
  const courses = useCourses();
  const terms = useTerms();
  const branches = useBranches();

  const klass = useQuery({
    queryKey: classKey(membership.org.id, classId),
    queryFn: ({ signal }) =>
      api<Class>('GET', orgApiPath(membership, `/classes/${classId}`), { signal }),
  });
  const term = terms.data?.data.find((x) => x.id === klass.data?.termId);
  const range = klass.data ? classRange(klass.data, term) : null;
  // Lessons from the class's first day (or 13 weeks back) to its last (or 13 weeks ahead).
  const from = range?.start ?? addDays(format.today, -91);
  const to = range?.end ?? addDays(format.today, 91);
  const sessions = useQuery({
    queryKey: ['sessions', membership.org.id, { classId, from, to }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(membership, `/sessions${query({ classId, from, to, limit: 200 })}`),
        { signal },
      ),
    enabled:
      Boolean(klass.data) && (Boolean(range?.start) || !klass.data?.termId) && !terms.isPending,
  });

  if (klass.isPending) return <PageLoading />;
  if (klass.isError) return <PageError error={klass.error} onRetry={() => void klass.refetch()} />;
  const data = klass.data;
  const manyBranches = (branches.data?.data.length ?? 0) > 1;
  const close = () => setOpen(null);
  const lessonMinutes =
    courses.data?.data.find((c) => c.id === data.courseId)?.durationMinutes ?? null;

  const when = data.termId
    ? term?.name
    : data.startDate
      ? t('classes.ongoingSince', { date: format.day(data.startDate) })
      : null;
  const meta = [
    courseLabel(data.courseId),
    when,
    manyBranches ? namesOf(branches.data?.data)(data.branchId) : null,
    data.roomName,
    data.teacherName,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link
            to={paths.list}
            className="inline-flex items-center gap-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase hover:underline"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            {t('classes.overline')}
          </Link>
          <h1 className="mt-1 flex items-center gap-2.5 text-title font-normal break-words text-text">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: classColour(data.id) }}
            />
            {data.name}
          </h1>
          <p className="mt-1 text-body text-muted">{meta}</p>
        </div>
        {canWrite ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => setOpen('edit')}>
              {t('classes.editButton')}
            </Button>
            <OverflowMenu
              label={t('classes.moreActions')}
              items={[
                {
                  label: t('classes.delete.menu'),
                  onSelect: () => setOpen('delete'),
                  danger: true,
                },
              ]}
            />
          </div>
        ) : null}
      </header>

      <Stats klass={data} sessions={sessions.data?.data} />

      <div role="tablist" className="mt-6 flex gap-6 border-b border-border">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setParams(name === 'students' ? {} : { tab: name }, { replace: true })}
            className={cn(
              '-mb-px h-11 border-b-2 px-0.5 text-body',
              tab === name
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(`classes.tab.${name}`)}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === 'students' ? (
          <StudentsTab klass={data} />
        ) : tab === 'lessons' ? (
          <LessonsTab klass={data} sessions={sessions} from={from} to={to} />
        ) : (
          <ScheduleTab klass={data} onEdit={canWrite ? () => setOpen('schedule') : undefined} />
        )}
      </div>

      <ClassDialog open={open === 'edit'} onClose={close} klass={data} />
      <ScheduleDialog
        open={open === 'schedule'}
        onClose={close}
        klass={data}
        lessonMinutes={lessonMinutes}
      />
      {open === 'delete' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={t('classes.delete.title', { name: data.name })}
          body={t('classes.delete.body')}
          action={t('classes.delete.action')}
          onConfirm={async () => {
            await api('DELETE', orgApiPath(membership, `/classes/${data.id}`));
            navigate(paths.list, { replace: true });
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Enrolled, how far through its lessons the class is, and the next lesson. */
function Stats({ klass, sessions }: { klass: Class; sessions: Session[] | undefined }) {
  const format = useFormat();
  const now = new Date().toISOString();
  const running = (sessions ?? []).filter((s) => s.status === 'scheduled');
  const done = running.filter((s) => s.endsAt <= now).length;
  const next = running.find((s) => s.startsAt > now);
  const left = klass.capacity === null ? null : Math.max(0, klass.capacity - klass.enrolledCount);

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <StatCard
        label={t('classes.stat.enrolled')}
        Icon={Users}
        value={
          klass.capacity === null
            ? klass.enrolledCount
            : t('classes.capacity', { n: klass.enrolledCount, capacity: klass.capacity })
        }
        note={
          left === null
            ? t('classes.stat.noLimit')
            : left === 0
              ? t('classes.stat.full')
              : t(left === 1 ? 'classes.stat.placeLeft' : 'classes.stat.placesLeft', { n: left })
        }
      />
      <StatCard
        label={t('classes.stat.lessons')}
        Icon={CalendarDays}
        value={sessions ? t('classes.stat.lessonsDone', { done, total: running.length }) : '–'}
        note={klass.termId ? t('classes.stat.thisTerm') : t('classes.stat.window')}
      />
      <StatCard
        className="col-span-2 lg:col-span-1"
        label={t('classes.stat.next')}
        Icon={CalendarClock}
        value={next ? format.day(next.date) : '–'}
        note={
          next
            ? [format.timeRange(next.startTime, next.endTime), next.roomName]
                .filter(Boolean)
                .join(' · ')
            : t('classes.stat.noNext')
        }
      />
    </div>
  );
}

// ── Students ────────────────────────────────────────────────────────────────

type StudentAction =
  { kind: 'withdraw' | 'transfer'; enrolment: Enrolment } | { kind: 'enrol' } | null;

function StudentsTab({ klass }: { klass: Class }) {
  const { membership } = useOrg();
  const format = useFormat();
  const people = usePeoplePaths();
  const [action, setAction] = useState<StudentAction>(null);
  const canWrite = can(membership.role, 'classes:write');
  const canSeePeople = can(membership.role, 'people:read');
  const enrolments = useQuery({
    queryKey: ['enrolments', membership.org.id, { classId: klass.id }],
    queryFn: ({ signal }) =>
      api<Page<Enrolment>>(
        'GET',
        orgApiPath(membership, `/enrolments${query({ classId: klass.id, limit: 200 })}`),
        { signal },
      ),
  });
  // Current students first, by name; then those who have left, most recent first.
  const list = [...(enrolments.data?.data ?? [])].sort((a, b) => {
    const left = (e: Enrolment) =>
      e.status !== 'active' || (e.endDate !== null && e.endDate < format.today);
    if (left(a) !== left(b)) return left(a) ? 1 : -1;
    if (left(a)) return (b.endDate ?? '').localeCompare(a.endDate ?? '');
    return `${a.studentLastName} ${a.studentFirstName}`.localeCompare(
      `${b.studentLastName} ${b.studentFirstName}`,
    );
  });

  return (
    <>
      <SectionCard
        title={t('classes.students')}
        action={
          canWrite ? (
            <Button
              size="sm"
              icon={<UserPlus className="size-4" />}
              onClick={() => setAction({ kind: 'enrol' })}
            >
              {t('classes.enrol.button')}
            </Button>
          ) : null
        }
      >
        {enrolments.isPending ? (
          <SkeletonRows rows={3} />
        ) : enrolments.isError ? (
          <CardEmpty>{errorMessage(enrolments.error)}</CardEmpty>
        ) : list.length === 0 ? (
          <EmptyState
            Icon={Users}
            title={t('classes.students.empty')}
            body={canWrite ? t('classes.students.emptyBody') : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((enrolment) => {
              const name = `${enrolment.studentFirstName} ${enrolment.studentLastName}`;
              const ended = enrolment.endDate !== null && enrolment.endDate < format.today;
              const active = enrolment.status === 'active' && !ended;
              const starts = enrolment.startDate > format.today;
              const items: MenuItem[] =
                canWrite && enrolment.status === 'active' && !ended
                  ? [
                      {
                        label: t('classes.transfer.menu'),
                        onSelect: () => setAction({ kind: 'transfer', enrolment }),
                      },
                      {
                        label: t('classes.withdraw.menu'),
                        onSelect: () => setAction({ kind: 'withdraw', enrolment }),
                        danger: true,
                      },
                    ]
                  : [];
              const nameEl = canSeePeople ? (
                <Link
                  to={people.student(enrolment.studentId)}
                  className="truncate text-body font-semibold text-text hover:underline"
                >
                  {name}
                </Link>
              ) : (
                <b className="truncate text-body font-semibold text-text">{name}</b>
              );
              return (
                <li key={enrolment.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                  <Avatar name={name} className="size-8 text-meta" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    {nameEl}
                    <small className="text-meta text-muted">
                      {enrolment.endDate
                        ? t('classes.enrolment.dates', {
                            from: format.date(enrolment.startDate),
                            to: format.date(enrolment.endDate),
                          })
                        : starts
                          ? t('classes.enrolment.starts', {
                              date: format.date(enrolment.startDate),
                            })
                          : t('classes.enrolment.since', {
                              date: format.date(enrolment.startDate),
                            })}
                    </small>
                  </span>
                  <Badge tone={active ? (starts ? 'info' : 'success') : 'neutral'}>
                    {active
                      ? starts
                        ? t('classes.enrolment.upcoming')
                        : t('people.enrolment.active')
                      : t('people.enrolment.withdrawn')}
                  </Badge>
                  {canWrite ? (
                    items.length ? (
                      <OverflowMenu label={t('classes.studentActions', { name })} items={items} />
                    ) : (
                      <span className="size-11 md:size-10" />
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {action?.kind === 'enrol' ? (
        <EnrolDialog klass={klass} onClose={() => setAction(null)} />
      ) : null}
      {action?.kind === 'withdraw' ? (
        <WithdrawDialog enrolment={action.enrolment} onClose={() => setAction(null)} />
      ) : null}
      {action?.kind === 'transfer' ? (
        <TransferDialog
          klass={klass}
          enrolment={action.enrolment}
          onClose={() => setAction(null)}
        />
      ) : null}
    </>
  );
}

// ── Lessons ─────────────────────────────────────────────────────────────────

type Row =
  | { kind: 'lesson'; date: string; session: Session }
  | { kind: 'holiday'; date: string; holiday: Holiday; time: string };

/**
 * The class's lessons by week, with the days a holiday closed. From two weeks back on at first,
 * with the earlier ones a click away.
 */
function LessonsTab({
  klass,
  sessions,
  from,
  to,
}: {
  klass: Class;
  sessions: ReturnType<typeof useQuery<Page<Session>>>;
  from: string;
  to: string;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const [earlier, setEarlier] = useState(false);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const holidays = useQuery({
    queryKey: ['holidays', membership.org.id],
    queryFn: ({ signal }) =>
      api<Page<Holiday>>('GET', orgApiPath(membership, '/holidays?limit=200'), { signal }),
    staleTime: 60_000,
  });

  if (sessions.isPending)
    return (
      <Card flush>
        <SkeletonRows />
      </Card>
    );
  if (sessions.isError)
    return <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />;

  const lessons = sessions.data.data;
  const rows: Row[] = lessons.map((session) => ({ kind: 'lesson', date: session.date, session }));
  // A holiday closes the class's weekdays in it: no lesson is generated, so show why.
  const closes = (holidays.data?.data ?? []).filter(
    (h) =>
      (h.branchId === null || h.branchId === klass.branchId) &&
      h.endDate >= from &&
      h.startDate <= to,
  );
  for (const holiday of closes) {
    for (
      let date = holiday.startDate > from ? holiday.startDate : from;
      date <= holiday.endDate && date <= to;
      date = addDays(date, 1)
    ) {
      for (const slot of klass.schedule) {
        if (isoWeekday(date) === slot.weekday && !lessons.some((s) => s.date === date)) {
          rows.push({
            kind: 'holiday',
            date,
            holiday,
            time: format.timeRange(slot.startTime, slot.endTime),
          });
        }
      }
    }
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === 'lesson' && b.kind === 'lesson'
        ? a.session.startTime.localeCompare(b.session.startTime)
        : 0),
  );

  const cutoff = weekOf(addDays(format.today, -7));
  const hidden = earlier ? 0 : rows.filter((r) => r.date < cutoff).length;
  const shown = earlier ? rows : rows.filter((r) => r.date >= cutoff);
  const weeks = new Map<string, Row[]>();
  for (const row of shown) {
    const week = weekOf(row.date);
    weeks.set(week, [...(weeks.get(week) ?? []), row]);
  }

  if (rows.length === 0) {
    return (
      <Card flush>
        <EmptyState
          Icon={CalendarDays}
          title={t('classes.lessons.empty')}
          body={klass.schedule.length ? undefined : t('classes.lessons.emptyBody')}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {hidden > 0 ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setEarlier(true)}>
            {t(hidden === 1 ? 'classes.lessons.earlierOne' : 'classes.lessons.earlier', {
              n: hidden,
            })}
          </Button>
        </div>
      ) : null}
      {[...weeks].map(([week, list]) => (
        <section key={week} aria-label={t('classes.lessons.week', { date: format.dayMonth(week) })}>
          <h3 className="mb-2 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
            {t('classes.lessons.week', { date: format.dayMonth(week) })}
          </h3>
          <Card flush className="overflow-hidden">
            <ul className="divide-y divide-border">
              {list.map((row) =>
                row.kind === 'holiday' ? (
                  <li
                    key={`${row.holiday.id}-${row.date}`}
                    className="flex min-h-[60px] items-center gap-3 bg-canvas/60 px-4 py-2.5 text-muted"
                  >
                    <CalendarOff className="size-4 shrink-0" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body">
                        {format.day(row.date)} · {row.time}
                      </span>
                      <small className="text-meta">
                        {t('classes.lessons.holiday', { name: row.holiday.name })}
                      </small>
                    </span>
                  </li>
                ) : (
                  <LessonRow key={row.session.id} session={row.session} onCancel={setCancelling} />
                ),
              )}
            </ul>
          </Card>
        </section>
      ))}
      {cancelling ? (
        <CancelLesson session={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  );
}

function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** One lesson: when, where and who, then what to do about its attendance. */
function LessonRow({ session, onCancel }: { session: Session; onCancel: (s: Session) => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  const refresh = useRefreshClasses();
  const toast = useToast();
  const cancelled = session.status === 'cancelled';
  const started = session.startsAt <= new Date().toISOString();
  const canWrite = can(membership.role, 'classes:write');
  const restore = useMutation({
    mutationFn: () =>
      api('PATCH', orgApiPath(membership, `/sessions/${session.id}`), {
        body: { updatedAt: session.updatedAt, status: 'scheduled' },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('classes.lesson.restored'));
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const items: MenuItem[] =
    canWrite && !started
      ? cancelled
        ? [{ label: t('classes.lesson.restore'), onSelect: () => restore.mutate() }]
        : [{ label: t('classes.lesson.cancel'), onSelect: () => onCancel(session), danger: true }]
      : [];
  const where = [session.roomName, session.teacherName].filter(Boolean).join(' · ');
  const moved = session.movedFrom
    ? t('people.lesson.moved', {
        when: `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`,
      })
    : null;

  const result = cancelled ? (
    <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>
  ) : (
    <LessonResult session={session} />
  );

  // On phones the result goes under the lesson's day, so the day keeps the row's width.
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <Link
          to={paths.lesson(session.id)}
          className="flex min-w-0 flex-1 flex-col rounded-md hover:underline"
        >
          <span
            className={cn(
              'text-body font-semibold text-text',
              cancelled && 'text-muted line-through',
            )}
          >
            {format.day(session.date)} · {format.timeRange(session.startTime, session.endTime)}
          </span>
          <small className="truncate text-meta text-muted">
            {[moved, where].filter(Boolean).join(' · ') || ' '}
          </small>
        </Link>
        {result ? <div className="shrink-0">{result}</div> : null}
      </div>
      {items.length ? (
        <OverflowMenu label={t('classes.lesson.actions')} items={items} />
      ) : canWrite ? (
        <span className="size-11 md:size-10" />
      ) : null}
    </li>
  );
}

function CancelLesson({ session, onClose }: { session: Session; onClose: () => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const refresh = useRefreshClasses();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={t('classes.lesson.cancelTitle', { when: format.day(session.date) })}
      body={t('classes.lesson.cancelBody')}
      action={t('classes.lesson.cancel')}
      onConfirm={async () => {
        await api('PATCH', orgApiPath(membership, `/sessions/${session.id}`), {
          body: { updatedAt: session.updatedAt, status: 'cancelled' },
        });
        await refresh();
        toast(t('classes.lesson.cancelled'));
      }}
    />
  );
}

// ── Schedule ────────────────────────────────────────────────────────────────

/** The weekly slots, and any clash in the next weeks between this class and another. */
function ScheduleTab({ klass, onEdit }: { klass: Class; onEdit?: () => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  const from = format.today;
  const to = addDays(from, CLASH_RANGE_DAYS - 1);
  const clashes = useQuery({
    queryKey: ['clashes', membership.org.id, { branchId: klass.branchId, from }],
    queryFn: ({ signal }) =>
      api<{ data: Clash[] }>(
        'GET',
        orgApiPath(
          membership,
          `/timetable/clashes${query({ from, to, branchId: klass.branchId })}`,
        ),
        { signal },
      ),
    enabled: klass.schedule.length > 0,
  });
  // One line per kind and other class: the first date it happens on, and how often.
  const mine = (clashes.data?.data ?? []).filter(
    (c) => c.kind !== 'student' && c.sessions.some((s) => s.classId === klass.id),
  );
  const grouped = new Map<string, { clash: Clash; other: string; count: number }>();
  for (const clash of mine) {
    const other = clash.sessions.find((s) => s.classId !== klass.id) ?? clash.sessions[1]!;
    const key = `${clash.kind}-${other.classId}`;
    const seen = grouped.get(key);
    grouped.set(key, {
      clash: seen?.clash ?? clash,
      other: other.className,
      count: (seen?.count ?? 0) + 1,
    });
  }
  const students = (clashes.data?.data ?? []).filter(
    (c) => c.kind === 'student' && c.sessions.some((s) => s.classId === klass.id),
  );

  const slots = sortSlots(klass.schedule);
  return (
    <div className="flex flex-col gap-4">
      {[...grouped.values()].map(({ clash, other, count }) => (
        <Notice
          key={`${clash.kind}-${other}`}
          tone="warning"
          title={t(`classes.clash.${clash.kind as 'room' | 'teacher' | 'grade'}`, { other })}
        >
          {t(count === 1 ? 'classes.clash.once' : 'classes.clash.times', {
            date: format.day(clash.date),
            n: count,
          })}
        </Notice>
      ))}
      {students.length ? (
        <Notice tone="warning" title={t('classes.clash.students')}>
          {t('classes.clash.studentsBody', { n: new Set(students.map((c) => c.studentId)).size })}
        </Notice>
      ) : null}
      <SectionCard
        title={t('classes.schedule.title')}
        subtitle={scheduleLabel(klass.schedule, format) || undefined}
        action={
          onEdit ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              {t('classes.schedule.edit')}
            </Button>
          ) : null
        }
      >
        {slots.length === 0 ? (
          <CardEmpty>{t('classes.schedule.empty')}</CardEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {slots.map((slot) => (
              <li
                key={`${slot.weekday}-${slot.startTime}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-meta font-semibold text-brand uppercase">
                  {format.weekday(slot.weekday)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <b className="text-body font-semibold text-text">
                    {format.weekdayLong(slot.weekday)} ·{' '}
                    {format.timeRange(slot.startTime, slot.endTime)}
                  </b>
                  <small className="text-meta text-muted">
                    {[klass.roomName, klass.teacherName].filter(Boolean).join(' · ') ||
                      t('classes.schedule.noRoomTeacher')}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <p className="text-meta text-muted">
        <Clock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        {t('classes.schedule.footnote')}{' '}
        <Link
          to={paths.class(klass.id, 'lessons')}
          className="font-medium text-brand hover:underline"
        >
          {t('classes.schedule.seeLessons')}
        </Link>
      </p>
    </div>
  );
}
