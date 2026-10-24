import type { Class } from '@edustrux/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  School,
  User,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError, PageHeader } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Button, buttonClass } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import {
  currentTerm,
  useClassPaths,
  useCourseLabel,
  useCourses,
  useCoursesPath,
  useTeachers,
  useTerms,
} from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { classColour, namesOf, query, useBranches, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { EmptyState, SkeletonRows } from '../people/parts';
import { ClassDialog } from './ClassDialog';
import { Capacity, scheduleLabel } from './parts';

/**
 * Classes (TUI-112): the classes the caller reaches, by term, branch, teacher and course. A
 * teacher sees the classes they teach. Parents use the portal instead.
 */
export function ClassesPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'classes:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Classes />;
}

/** Terms load once; until then the list waits, so it doesn't flash every class first. */
const ALL = 'all';

function Classes() {
  const { membership } = useOrg();
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState(false);
  const canWrite = can(membership.role, 'classes:write');

  const terms = useTerms();
  const branches = useBranches();
  const courses = useCourses();
  const teachers = useTeachers();
  const courseLabel = useCourseLabel();
  const coursesPath = useCoursesPath();

  const termList = terms.data?.data ?? [];
  const thisTerm = currentTerm(termList, format.today);
  // The term filter starts on the current term; "all" shows every class, with or without one.
  const termParam = params.get('term');
  const termId = termParam === ALL ? '' : (termParam ?? thisTerm?.id ?? '');
  const branchId = params.get('branch') ?? '';
  const teacherId = params.get('teacher') ?? '';
  const courseId = params.get('course') ?? '';
  const own = membership.branchIds;
  const branchChoices = (branches.data?.data ?? []).filter((b) => !own || own.includes(b.id));
  const manyBranches = (branches.data?.data.length ?? 0) > 1;

  function set(next: Record<string, string>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated, { replace: true });
  }

  const list = useInfiniteQuery({
    queryKey: ['classes', membership.org.id, { termId, branchId, teacherId, courseId }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Class>>(
        'GET',
        orgApiPath(
          membership,
          `/classes${query({ limit: 100, termId, branchId, teacherId, courseId, cursor: pageParam })}`,
        ),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !terms.isPending,
  });

  // Loading more pages until the list is whole keeps the search and the totals honest.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const q = typed.trim().toLowerCase();
  const shown = q
    ? rows.filter((c) =>
        `${c.name} ${courseLabel(c.courseId)} ${c.teacherName ?? ''}`.toLowerCase().includes(q),
      )
    : rows;
  const whole = list.isSuccess && !hasNextPage;
  const enrolled = rows.reduce((sum, c) => sum + c.enrolledCount, 0);

  return (
    <>
      <PageHeader
        overline={t('classes.overline')}
        title={t('classes.title')}
        subtitle={
          whole && rows.length
            ? t(rows.length === 1 ? 'classes.subtitle.one' : 'classes.subtitle', {
                n: rows.length,
                students: enrolled,
              })
            : t('classes.subtitle.empty')
        }
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              {t('classes.add')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {termList.length > 0 ? (
            <FilterSelect
              Icon={CalendarDays}
              label={t('classes.filter.term')}
              value={termParam === ALL ? ALL : termId}
              onChange={(value) => set({ term: value })}
              options={[
                { value: ALL, label: t('classes.filter.allTerms') },
                ...termList.map((term) => ({ value: term.id, label: term.name })),
              ]}
            />
          ) : null}
          {branchChoices.length > 1 ? (
            <FilterSelect
              Icon={MapPin}
              label={t('classes.filter.branch')}
              value={branchId}
              onChange={(value) => set({ branch: value })}
              options={[
                { value: '', label: t('people.filter.allBranches') },
                ...branchChoices.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          ) : null}
          {teachers.data && teachers.data.data.length > 1 ? (
            <FilterSelect
              Icon={User}
              label={t('classes.filter.teacher')}
              value={teacherId}
              onChange={(value) => set({ teacher: value })}
              options={[
                { value: '', label: t('classes.filter.anyone') },
                ...teachers.data.data.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          ) : null}
          {(courses.data?.data.length ?? 0) > 1 ? (
            <FilterSelect
              Icon={BookOpen}
              label={t('classes.filter.course')}
              value={courseId}
              onChange={(value) => set({ course: value })}
              options={[
                { value: '', label: t('classes.filter.allCourses') },
                ...courses
                  .data!.data.map((c) => ({ value: c.id, label: courseLabel(c.id) }))
                  .sort((a, b) => a.label.localeCompare(b.label)),
              ]}
            />
          ) : null}
        </div>
        <label className="flex h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-subtle focus-within:outline-2 focus-within:outline-brand sm:h-10 lg:w-[260px]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('classes.search')}
            aria-label={t('classes.search')}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <Card flush className="overflow-hidden">
        {list.isPending ? (
          <SkeletonRows />
        ) : list.isError ? (
          <PageError error={list.error} onRetry={() => void list.refetch()} />
        ) : shown.length === 0 ? (
          q || termId || branchId || teacherId || courseId ? (
            <EmptyState Icon={School} title={t('classes.empty.filtered')} />
          ) : (
            <EmptyState
              Icon={School}
              title={t('classes.empty')}
              body={canWrite ? t('classes.empty.body') : undefined}
              action={
                canWrite ? (
                  <>
                    <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                      {t('classes.add')}
                    </Button>
                    <Link to={coursesPath()} className={buttonClass('secondary')}>
                      {t('classes.manageCourses')}
                    </Link>
                  </>
                ) : null
              }
            />
          )
        ) : (
          <ClassRows rows={shown} manyBranches={manyBranches} courseLabel={courseLabel} />
        )}
      </Card>

      <ClassDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const GRID =
  'md:grid md:grid-cols-[minmax(200px,1.6fr)_minmax(160px,1.3fr)_minmax(90px,0.7fr)_minmax(140px,1fr)_110px_20px]';

function ClassRows({
  rows,
  manyBranches,
  courseLabel,
}: {
  rows: Class[];
  manyBranches: boolean;
  courseLabel: (courseId: string) => string;
}) {
  const format = useFormat();
  const paths = useClassPaths();
  const terms = useTerms();
  const termName = namesOf(terms.data?.data);
  const branchName = namesOf(useBranches().data?.data);

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'hidden h-[42px] items-center gap-4 border-b border-border bg-[#fafbfb] px-4 text-meta font-semibold text-muted',
          GRID,
        )}
      >
        <span>{t('classes.col.class')}</span>
        <span>{t('classes.col.schedule')}</span>
        <span>{t('classes.col.room')}</span>
        <span>{t('classes.col.teacher')}</span>
        <span>{t('classes.col.enrolled')}</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((klass) => {
          const when = klass.termId
            ? termName(klass.termId)
            : klass.startDate
              ? klass.startDate > format.today
                ? t('classes.startsOn', { date: format.day(klass.startDate) })
                : t('classes.ongoingSince', { date: format.day(klass.startDate) })
              : '';
          const meta = [
            courseLabel(klass.courseId),
            when,
            manyBranches ? branchName(klass.branchId) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const schedule = scheduleLabel(klass.schedule, format);
          return (
            <li key={klass.id}>
              <Link
                to={paths.class(klass.id)}
                className={cn(
                  'flex min-h-[64px] items-center gap-3 py-2.5 pr-4 pl-3 text-body text-text hover:bg-canvas md:min-h-[56px] md:gap-4',
                  GRID,
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                  <span
                    aria-hidden
                    className="h-10 w-[3px] shrink-0 rounded-full"
                    style={{ background: classColour(klass.id) }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate font-semibold">{klass.name}</b>
                    <small className="truncate text-meta text-muted">{meta}</small>
                    {/* On phones the schedule is a second meta line; the columns are hidden. */}
                    <small className="truncate text-meta text-muted md:hidden">
                      {[schedule || t('classes.noSchedule'), klass.roomName]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </span>
                <span className={cn('hidden min-w-0 md:block', !schedule && 'text-subtle')}>
                  {schedule || t('classes.noSchedule')}
                </span>
                <span className="hidden truncate md:block">
                  {klass.roomName ?? <span className="text-subtle">—</span>}
                </span>
                <span className="hidden min-w-0 items-center gap-2 md:flex">
                  {klass.teacherName ? (
                    <>
                      <Avatar name={klass.teacherName} className="size-7 text-meta" />
                      <span className="truncate">{klass.teacherName}</span>
                    </>
                  ) : (
                    <span className="text-subtle">{t('classes.noTeacher')}</span>
                  )}
                </span>
                <Capacity klass={klass} />
                <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
