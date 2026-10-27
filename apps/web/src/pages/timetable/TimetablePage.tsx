import type { Class, Clash, Holiday, SearchResults, Session, Student } from '@edustrux/shared';
import { localNow } from '@edustrux/shared/dates';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  Plus,
  School,
  Search,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useRooms, useTeachers, useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, studentKey, useBranches, useGradeLevels, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import {
  clashesBySession,
  stepDate,
  VIEW_BYS,
  VIEWS,
  viewRange,
  type View,
  type ViewBy,
} from '../../lib/timetable';
import { ClassDialog } from '../classes/ClassDialog';
import { EmptyState, SkeletonRows } from '../people/parts';
import { LessonDialog } from './LessonDialog';
import { DayView, MonthView, PhoneAgenda, WeekView } from './views';

/**
 * Timetable (TUI-51): the lessons the caller reaches by day, week or month, from
 * `GET /sessions` and its filters. Staff see their branches, teachers their own classes.
 * Parents use the portal instead.
 */
export function TimetablePage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'classes:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Timetable />;
}

/** Every lesson in the dates, a page at a time: a busy month runs past one page. */
async function allSessions(path: string, signal: AbortSignal) {
  const sessions: Session[] = [];
  let cursor = '';
  do {
    const url = cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
    const page = await api<Page<Session>>('GET', url, { signal });
    sessions.push(...page.data);
    cursor = page.nextCursor ?? '';
  } while (cursor);
  return sessions;
}

function Timetable() {
  const { membership, org } = useOrg();
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Session | null>(null);
  const [adding, setAdding] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const orgId = membership.org.id;

  const view: View = VIEWS.find((v) => v === params.get('view')) ?? 'week';
  const by: ViewBy = VIEW_BYS.find((v) => v === params.get('by')) ?? 'branch';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '')
    ? params.get('date')!
    : format.today;
  const filters = {
    branchId: params.get('branch') ?? '',
    roomId: params.get('room') ?? '',
    teacherId: params.get('teacher') ?? '',
    gradeLevelId: params.get('grade') ?? '',
    classId: params.get('class') ?? '',
    studentId: by === 'student' ? (params.get('student') ?? '') : '',
  };
  const { from, to } = viewRange(view, date);

  function set(next: Record<string, string>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated, { replace: true });
  }

  const branches = useBranches();
  const own = membership.branchIds;
  const branchChoices = (branches.data?.data ?? []).filter((b) => !own || own.includes(b.id));
  // Rooms belong to a branch: the one chosen, or the only one the caller has.
  const roomBranch =
    filters.branchId || (branchChoices.length === 1 ? branchChoices[0]!.id : undefined);
  const rooms = useRooms(roomBranch);
  const teachers = useTeachers();
  const grades = useGradeLevels();
  const terms = useTerms();
  const classes = useQuery({
    queryKey: ['classes', orgId, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<Class>>('GET', orgApiPath(membership, '/classes?limit=200'), { signal }),
    staleTime: 60_000,
  });
  const holidays = useQuery({
    queryKey: ['holidays', orgId],
    queryFn: ({ signal }) =>
      api<Page<Holiday>>('GET', orgApiPath(membership, '/holidays?limit=200'), { signal }),
    staleTime: 60_000,
  });

  const needsStudent = by === 'student' && !filters.studentId;
  const sessions = useQuery({
    queryKey: ['sessions', orgId, { from, to, ...filters }],
    queryFn: ({ signal }) =>
      allSessions(
        orgApiPath(membership, `/sessions${query({ from, to, limit: 200, ...filters })}`),
        signal,
      ),
    enabled: !needsStudent,
  });
  const clashQuery = useQuery({
    queryKey: ['clashes', orgId, { from, to, branchId: filters.branchId }],
    queryFn: ({ signal }) =>
      api<{ data: Clash[] }>(
        'GET',
        orgApiPath(
          membership,
          `/timetable/clashes${query({ from, to, branchId: filters.branchId })}`,
        ),
        { signal },
      ),
  });

  const list = sessions.data ?? [];
  const shownIds = new Set(list.map((s) => s.id));
  const clashes = clashesBySession(
    (clashQuery.data?.data ?? []).filter((c) => c.sessions.some((s) => shownIds.has(s.id))),
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const clashKey = `${from}-${to}-${clashes.shown.length}`;
  // A branch's own holidays only show once that branch is chosen (or is the only one).
  const closed = (holidays.data?.data ?? []).filter(
    (h) => h.branchId === null || h.branchId === roomBranch,
  );
  const now = localNow(org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).time;
  const canAddClass = can(membership.role, 'classes:write');
  const canPickStudent = can(membership.role, 'people:read');

  const overline =
    view === 'day'
      ? `${format.dayLong(date)} ${date.slice(0, 4)}`
      : view === 'week'
        ? t('timetable.overline.week', { date: `${format.dayMonth(from)} ${from.slice(0, 4)}` })
        : format.month(date.slice(0, 7));

  const filterSelects = (
    <>
      {branchChoices.length > 1 ? (
        <FilterSelect
          Icon={School}
          label={t('timetable.filter.branch')}
          value={filters.branchId}
          onChange={(value) => set({ branch: value, room: '' })}
          options={[
            { value: '', label: t('people.filter.allBranches') },
            ...branchChoices.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
      ) : null}
      {(rooms.data?.data.length ?? 0) > 0 ? (
        <FilterSelect
          Icon={MapPin}
          label={t('timetable.filter.room')}
          value={filters.roomId}
          onChange={(value) => set({ room: value })}
          options={[
            { value: '', label: t('timetable.filter.anyRoom') },
            ...rooms.data!.data.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      ) : null}
      {(teachers.data?.data.length ?? 0) > 1 ? (
        <FilterSelect
          Icon={User}
          label={t('timetable.filter.teacher')}
          value={filters.teacherId}
          onChange={(value) => set({ teacher: value })}
          options={[
            { value: '', label: t('timetable.filter.anyone') },
            ...teachers.data!.data.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
      ) : null}
      {(grades.data?.data.length ?? 0) > 1 ? (
        <FilterSelect
          Icon={GraduationCap}
          label={t('timetable.filter.grade')}
          value={filters.gradeLevelId}
          onChange={(value) => set({ grade: value })}
          options={[
            { value: '', label: t('timetable.filter.allGrades') },
            ...grades.data!.data.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      ) : null}
      {(classes.data?.data.length ?? 0) > 1 ? (
        <FilterSelect
          Icon={BookOpen}
          label={t('timetable.filter.class')}
          value={filters.classId}
          onChange={(value) => set({ class: value })}
          options={[
            { value: '', label: t('timetable.filter.allClasses') },
            ...[...classes.data!.data]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      ) : null}
    </>
  );
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && k !== 'studentId').length;

  const viewBy = (
    <Segmented
      label={t('timetable.viewBy')}
      value={by}
      onChange={(value) => set({ by: value === 'branch' ? '' : value })}
      options={VIEW_BYS.filter((v) => v !== 'student' || canPickStudent).map((v) => ({
        value: v,
        label: t(`timetable.viewBy.${v}`),
      }))}
    />
  );
  const arrows = (
    <div className="flex">
      <button
        type="button"
        aria-label={t('timetable.previous')}
        onClick={() => set({ date: stepDate(view, date, -1) })}
        className="grid size-11 place-items-center rounded-l-lg border border-border-strong bg-surface text-muted hover:bg-canvas sm:size-10"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('timetable.next')}
        onClick={() => set({ date: stepDate(view, date, 1) })}
        className="grid size-11 place-items-center rounded-r-lg border border-l-0 border-border-strong bg-surface text-muted hover:bg-canvas sm:size-10"
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
  const todayButton = (
    <Button variant="secondary" onClick={() => set({ date: '' })}>
      {t('timetable.today')}
    </Button>
  );

  const empty = (
    <EmptyState
      Icon={CalendarDays}
      title={t(`timetable.empty.${view}`)}
      body={t('timetable.empty.body')}
      action={
        canAddClass ? (
          <Button
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => setAdding(true)}
          >
            {t('timetable.addClass')}
          </Button>
        ) : undefined
      }
    />
  );
  const calendar = {
    sessions: list,
    clashes: clashes.bySession,
    holidays: closed,
    terms: terms.data?.data ?? [],
    now,
    onOpen: setOpen,
  };
  const firstClash = [...clashes.shown].sort((a, b) => a.date.localeCompare(b.date))[0];

  return (
    <div className="pb-10">
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
            {overline}
          </p>
          <h1 className="text-title font-normal text-text">{t('timetable.title')}</h1>
        </div>
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <Segmented
            label={t('timetable.view')}
            value={view}
            onChange={(value) => set({ view: value === 'week' ? '' : value })}
            options={VIEWS.map((v) => ({ value: v, label: t(`timetable.view.${v}`) }))}
          />
          {todayButton}
          {arrows}
          <DateButton date={date} onChange={(value) => set({ date: value })} />
        </div>
      </header>

      {/* Phones: filters in a sheet, the arrows step a week, the strip picks the day. */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        <Button
          variant="secondary"
          icon={<SlidersHorizontal className="size-4" />}
          onClick={() => setFiltering(true)}
        >
          {t('timetable.filters')}
          {activeFilters ? <Badge tone="brand">{activeFilters}</Badge> : null}
        </Button>
        <span className="ml-auto" />
        {todayButton}
        <div className="flex">
          <button
            type="button"
            aria-label={t('timetable.previous')}
            onClick={() => set({ date: stepDate('week', date, -1) })}
            className="grid size-11 place-items-center rounded-l-lg border border-border-strong bg-surface text-muted"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('timetable.next')}
            onClick={() => set({ date: stepDate('week', date, 1) })}
            className="grid size-11 place-items-center rounded-r-lg border border-l-0 border-border-strong bg-surface text-muted"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mb-4 hidden flex-wrap items-center justify-between gap-3 sm:flex">
        <div className="flex items-center gap-2.5">
          <span className="text-label font-medium text-text">{t('timetable.viewBy')}</span>
          {viewBy}
        </div>
        <div className="flex flex-wrap justify-end gap-2">{filterSelects}</div>
      </div>

      {by === 'student' ? (
        <StudentPicker
          studentId={filters.studentId}
          onPick={(id) => set({ student: id })}
          onClear={() => set({ student: '', by: '' })}
        />
      ) : null}

      {clashes.shown.length > 0 && dismissed !== clashKey ? (
        <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#ecd49e] bg-warning-soft px-3 py-2.5 text-body text-warning">
          <Clock className="size-4 shrink-0" aria-hidden />
          <b className="flex-1 font-semibold">
            {view === 'week'
              ? t(
                  clashes.shown.length === 1
                    ? 'timetable.clashes.oneWeek'
                    : 'timetable.clashes.week',
                  {
                    n: clashes.shown.length,
                  },
                )
              : t(clashes.shown.length === 1 ? 'timetable.clashes.one' : 'timetable.clashes', {
                  n: clashes.shown.length,
                })}
          </b>
          {firstClash && !(view === 'day' && firstClash.date === date) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ view: 'day', date: firstClash.date })}
            >
              {t('timetable.clashes.review')}
            </Button>
          ) : null}
          <button
            type="button"
            aria-label={t('common.dismiss')}
            onClick={() => setDismissed(clashKey)}
            className="grid size-8 place-items-center rounded-md hover:bg-[#fbe9c4]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {needsStudent ? null : sessions.isPending ? (
        <Card flush>
          <SkeletonRows />
        </Card>
      ) : sessions.isError ? (
        <PageError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <>
          <div className="hidden sm:block">
            {list.length === 0 && view !== 'day' ? (
              <Card flush>{empty}</Card>
            ) : view === 'week' ? (
              <WeekView from={from} {...calendar} />
            ) : view === 'day' ? (
              <DayView date={date} by={by} {...calendar} />
            ) : (
              <MonthView
                date={date}
                from={from}
                to={to}
                {...calendar}
                onDay={(day) => set({ view: 'day', date: day })}
              />
            )}
          </div>
          <div className="sm:hidden">
            <PhoneAgenda
              date={date}
              onDate={(day) => set({ date: day })}
              empty={<Card flush>{empty}</Card>}
              {...calendar}
            />
          </div>
        </>
      )}

      {open ? (
        <LessonDialog
          key={open.id}
          session={open}
          clashes={clashes.bySession.get(open.id) ?? []}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {adding ? <ClassDialog open onClose={() => setAdding(false)} /> : null}
      <Dialog
        open={filtering}
        onClose={() => setFiltering(false)}
        title={t('timetable.filtersTitle')}
        actions={<Button onClick={() => setFiltering(false)}>{t('common.done')}</Button>}
      >
        <div className="flex flex-col gap-3">
          <span className="text-label font-medium text-text">{t('timetable.viewBy')}</span>
          {viewBy}
          <div className="flex flex-col gap-2 [&>label]:w-full">{filterSelects}</div>
        </div>
      </Dialog>
    </div>
  );
}

/** Buttons of which one is on: Day / Week / Month, and Branch / Room / Teacher / Student. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-11 overflow-hidden rounded-lg border border-border-strong sm:h-10"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-w-[64px] flex-1 border-r border-border px-3 text-label last:border-r-0',
            option.value === value
              ? 'bg-brand-soft font-semibold text-brand'
              : 'bg-surface text-muted hover:bg-canvas',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "13 October 2026" with a calendar icon; opens the browser's date picker. */
function DateButton({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const format = useFormat();
  const input = useRef<HTMLInputElement>(null);
  return (
    <label className="relative inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-label font-medium text-text hover:bg-canvas">
      <CalendarDays className="size-4 text-muted" aria-hidden />
      {format.dayMonth(date)} {date.slice(0, 4)}
      <input
        ref={input}
        type="date"
        aria-label={t('timetable.pickDate')}
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={() => input.current?.showPicker?.()}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

/**
 * One student's timetable: find them by name (`GET /search`), then their lessons show. The
 * chosen student stays in the address, so the view can be shared or reloaded.
 */
function StudentPicker({
  studentId,
  onPick,
  onClear,
}: {
  studentId: string;
  onPick: (id: string) => void;
  onClear: () => void;
}) {
  const { membership } = useOrg();
  const [typed, setTyped] = useState('');
  const q = typed.trim();
  const student = useQuery({
    queryKey: studentKey(membership.org.id, studentId),
    queryFn: ({ signal }) =>
      api<Student>('GET', orgApiPath(membership, `/students/${studentId}`), { signal }),
    enabled: Boolean(studentId),
  });
  const results = useQuery({
    queryKey: ['search', membership.org.id, q],
    queryFn: ({ signal }) =>
      api<SearchResults>('GET', orgApiPath(membership, `/search${query({ q, limit: 8 })}`), {
        signal,
      }),
    enabled: q.length > 0 && !studentId,
    staleTime: 30_000,
  });

  if (studentId) {
    const name = student.data ? `${student.data.firstName} ${student.data.lastName}` : '…';
    return (
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-label">
          <User className="size-4 text-muted" aria-hidden />
          <b className="font-semibold text-text">{name}</b>
        </span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t('timetable.student.clear')}
        </Button>
      </div>
    );
  }

  const found = results.data?.students ?? [];
  return (
    <Card className="mb-3 flex flex-col gap-3">
      <p className="text-body text-muted">{t('timetable.student.pick')}</p>
      <label className="flex h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-subtle focus-within:outline-2 focus-within:outline-brand sm:h-10 sm:max-w-[360px]">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t('timetable.student.placeholder')}
          aria-label={t('timetable.student.search')}
          className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
        />
      </label>
      {q && results.isSuccess ? (
        found.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border sm:max-w-[360px]">
            {found.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s.id)}
                  className="flex min-h-11 w-full flex-col px-3 py-2 text-left hover:bg-canvas"
                >
                  <b className="text-body font-semibold text-text">
                    {s.firstName} {s.lastName}
                  </b>
                  <small className="text-meta text-muted">{s.familyName}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-muted">{t('timetable.student.none')}</p>
        )
      ) : null}
    </Card>
  );
}
