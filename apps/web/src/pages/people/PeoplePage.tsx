import type { Family, SearchResults, Student } from '@edustrux/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronRight, MapPin, Search, UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError, PageHeader } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  guardianName,
  mainContact,
  namesOf,
  portalSignedIn,
  query,
  useBranches,
  useGradeLevels,
  usePeoplePaths,
  type Page,
} from '../../lib/people';
import { can } from '../../lib/roles';
import { AddFamilyDialog } from './AddFamilyDialog';
import { EmptyState, SkeletonRows } from './parts';
import { countLabel } from './labels';

type Tab = 'families' | 'students';

/**
 * Families & students (TUI-109): every family or student the caller reaches, with branch and
 * grade filters and a search. Parents use the portal instead, so they don't get this page.
 */
export function PeoplePage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'people:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <People />;
}

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function People() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'students' ? 'students' : 'families';
  const branchId = params.get('branch') ?? '';
  const gradeId = params.get('grade') ?? '';
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [adding, setAdding] = useState(false);
  const canWrite = can(membership.role, 'people:write');

  const branches = useBranches();
  const grades = useGradeLevels();
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

  return (
    <>
      <PageHeader
        overline={t('people.overline')}
        title={t('people.title')}
        subtitle={t('people.subtitle')}
        action={
          canWrite ? (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              {t('people.addFamily')}
            </Button>
          ) : null
        }
      />

      <div role="tablist" className="flex gap-6 border-b border-border">
        {(['families', 'students'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => set({ tab: name === 'students' ? 'students' : '', grade: '' })}
            className={cn(
              '-mb-px h-11 border-b-2 px-0.5 text-body',
              tab === name
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(`people.tab.${name}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {branchChoices.length > 1 ? (
            <FilterSelect
              Icon={MapPin}
              label={t('people.filter.branch')}
              value={branchId}
              onChange={(value) => set({ branch: value })}
              options={[
                { value: '', label: t('people.filter.allBranches') },
                ...branchChoices.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          ) : null}
          {tab === 'students' && (grades.data?.data.length ?? 0) > 0 ? (
            <FilterSelect
              Icon={BookOpen}
              label={t('people.filter.grade')}
              value={gradeId}
              onChange={(value) => set({ grade: value })}
              options={[
                { value: '', label: t('people.filter.allGrades') },
                ...grades.data!.data.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          ) : null}
        </div>
        <label className="flex h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-subtle focus-within:outline-2 focus-within:outline-brand sm:h-10 sm:w-[280px]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t(`people.search.${tab}`)}
            aria-label={t(`people.search.${tab}`)}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <Card flush className="overflow-hidden">
        {q ? (
          <SearchList tab={tab} q={q} onClear={() => setTyped('')} manyBranches={manyBranches} />
        ) : tab === 'families' ? (
          <FamilyList
            branchId={branchId}
            manyBranches={manyBranches}
            onAdd={canWrite ? () => setAdding(true) : undefined}
          />
        ) : (
          <StudentList branchId={branchId} gradeId={gradeId} manyBranches={manyBranches} />
        )}
      </Card>

      <AddFamilyDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const FAMILY_GRID =
  'md:grid md:grid-cols-[minmax(170px,1.35fr)_minmax(150px,1.2fr)_minmax(130px,1fr)_110px_120px_20px]';
const FAMILY_GRID_ONE_BRANCH =
  'md:grid md:grid-cols-[minmax(170px,1.35fr)_minmax(150px,1.2fr)_minmax(130px,1fr)_120px_20px]';
const STUDENT_GRID =
  'md:grid md:grid-cols-[minmax(200px,1.5fr)_minmax(120px,1fr)_100px_60px_120px_20px]';
const STUDENT_GRID_ONE_BRANCH =
  'md:grid md:grid-cols-[minmax(200px,1.5fr)_minmax(120px,1fr)_100px_60px_20px]';

function HeadRow({ grid, cells }: { grid: string; cells: string[] }) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden h-[42px] items-center gap-4 border-b border-border bg-[#fafbfb] px-4 text-meta font-semibold text-muted',
        grid,
      )}
    >
      {cells.map((cell, i) => (
        <span key={i}>{cell}</span>
      ))}
    </div>
  );
}

function RowLink({ to, grid, children }: { to: string; grid: string; children: ReactNode }) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex min-h-[60px] items-center gap-3 px-4 py-2 text-body text-text hover:bg-canvas md:min-h-[52px] md:gap-4',
          grid,
        )}
      >
        {children}
        <ChevronRight className="ml-auto size-4 shrink-0 text-subtle md:ml-0" aria-hidden />
      </Link>
    </li>
  );
}

function TwoLines({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 flex-col', className)}>
      <b className="truncate text-body font-semibold">{title}</b>
      {meta ? <small className="truncate text-meta text-muted">{meta}</small> : null}
    </span>
  );
}

function LoadMore({
  list,
}: {
  list: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  if (!list.hasNextPage) return null;
  return (
    <div className="grid h-16 place-items-center border-t border-border">
      <Button
        variant="secondary"
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      >
        {t('common.loadMore')}
      </Button>
    </div>
  );
}

function PortalBadge({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <Badge tone="success">{t('people.portal.signedIn')}</Badge>
  ) : (
    <Badge tone="neutral">{t('people.portal.notSignedIn')}</Badge>
  );
}

function FamilyList({
  branchId,
  manyBranches,
  onAdd,
}: {
  branchId: string;
  manyBranches: boolean;
  onAdd?: () => void;
}) {
  const { membership } = useOrg();
  const paths = usePeoplePaths();
  const branchName = namesOf(useBranches().data?.data);
  const families = useInfiniteQuery({
    queryKey: ['families', membership.org.id, { branchId }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Family>>(
        'GET',
        orgApiPath(membership, `/families${query({ limit: 50, branchId, cursor: pageParam })}`),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (families.isPending) return <SkeletonRows />;
  if (families.isError)
    return <PageError error={families.error} onRetry={() => void families.refetch()} />;
  const rows = families.data.pages.flatMap((p) => p.data);
  if (rows.length === 0) {
    return branchId ? (
      <EmptyState Icon={UsersRound} title={t('people.empty.filtered')} />
    ) : (
      <EmptyState
        Icon={UsersRound}
        title={t('people.empty.families')}
        body={onAdd ? t('people.empty.familiesBody') : undefined}
        action={
          onAdd ? (
            <Button icon={<UserPlus className="size-4" />} onClick={onAdd}>
              {t('people.addFamily')}
            </Button>
          ) : null
        }
      />
    );
  }

  const grid = manyBranches ? FAMILY_GRID : FAMILY_GRID_ONE_BRANCH;
  return (
    <>
      <HeadRow
        grid={grid}
        cells={[
          t('people.col.family'),
          t('people.col.contact'),
          t('people.col.students'),
          ...(manyBranches ? [t('people.col.branch')] : []),
          t('people.col.portal'),
          '',
        ]}
      />
      <ul className="divide-y divide-border">
        {rows.map((family) => {
          const contact = mainContact(family);
          return (
            <RowLink key={family.id} to={paths.family(family.id)} grid={grid}>
              <TwoLines
                title={t('people.familyName', { name: family.name })}
                meta={[
                  countLabel('students', family.students.length),
                  countLabel('guardians', family.guardians.length),
                ].join(' · ')}
                className="flex-1 md:flex-none"
              />
              <span className="hidden min-w-0 md:block">
                {contact ? (
                  <TwoLines title={guardianName(contact)} meta={contact.phone ?? contact.email} />
                ) : (
                  <span className="text-muted">{t('people.noContact')}</span>
                )}
              </span>
              <span className="hidden min-w-0 gap-1 overflow-hidden md:flex">
                {family.students.map((s) => (
                  <span
                    key={s.id}
                    className="rounded-full bg-brand-soft px-2 py-0.5 text-meta whitespace-nowrap text-brand"
                  >
                    {s.firstName}
                  </span>
                ))}
              </span>
              {manyBranches ? (
                <span className="hidden truncate md:block">{branchName(family.branchId)}</span>
              ) : null}
              <span className="shrink-0">
                <PortalBadge signedIn={portalSignedIn(family)} />
              </span>
            </RowLink>
          );
        })}
      </ul>
      <LoadMore list={families} />
    </>
  );
}

function StudentList({
  branchId,
  gradeId,
  manyBranches,
}: {
  branchId: string;
  gradeId: string;
  manyBranches: boolean;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = usePeoplePaths();
  const branchName = namesOf(useBranches().data?.data);
  const gradeName = namesOf(useGradeLevels().data?.data);
  const students = useInfiniteQuery({
    queryKey: ['students', membership.org.id, { branchId, gradeId }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Student>>(
        'GET',
        orgApiPath(
          membership,
          `/students${query({ limit: 50, branchId, gradeLevelId: gradeId, cursor: pageParam })}`,
        ),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (students.isPending) return <SkeletonRows />;
  if (students.isError)
    return <PageError error={students.error} onRetry={() => void students.refetch()} />;
  const rows = students.data.pages.flatMap((p) => p.data);
  if (rows.length === 0) {
    return (
      <EmptyState
        Icon={UsersRound}
        title={branchId || gradeId ? t('people.empty.filtered') : t('people.empty.students')}
      />
    );
  }

  const grid = manyBranches ? STUDENT_GRID : STUDENT_GRID_ONE_BRANCH;
  return (
    <>
      <HeadRow
        grid={grid}
        cells={[
          t('people.col.student'),
          t('people.col.family'),
          t('people.col.grade'),
          t('people.col.age'),
          ...(manyBranches ? [t('people.col.branch')] : []),
          '',
        ]}
      />
      <ul className="divide-y divide-border">
        {rows.map((student) => {
          const name = `${student.firstName} ${student.lastName}`;
          const grade = gradeName(student.gradeLevelId);
          return (
            <RowLink key={student.id} to={paths.student(student.id)} grid={grid}>
              <span className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                <Avatar name={name} className="size-8 text-meta" />
                <TwoLines
                  title={name}
                  meta={
                    <span className="md:hidden">
                      {[t('people.familyName', { name: student.familyName }), grade]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  }
                />
              </span>
              <span className="hidden truncate md:block">
                {t('people.familyName', { name: student.familyName })}
              </span>
              <span className="hidden md:block">{grade ? <Badge>{grade}</Badge> : null}</span>
              <span className="hidden tabular-nums md:block">
                {student.dateOfBirth ? format.age(student.dateOfBirth) : ''}
              </span>
              {manyBranches ? (
                <span className="hidden truncate md:block">{branchName(student.branchId)}</span>
              ) : null}
            </RowLink>
          );
        })}
      </ul>
      <LoadMore list={students} />
    </>
  );
}

/** While something is typed: the API's prefix search, for the tab's kind (no paging). */
function SearchList({
  tab,
  q,
  onClear,
  manyBranches,
}: {
  tab: Tab;
  q: string;
  onClear: () => void;
  manyBranches: boolean;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = usePeoplePaths();
  const branchName = namesOf(useBranches().data?.data);
  const results = useQuery({
    queryKey: ['search', membership.org.id, q, 50],
    queryFn: ({ signal }) =>
      api<SearchResults>('GET', orgApiPath(membership, `/search${query({ q, limit: 50 })}`), {
        signal,
      }),
  });

  if (results.isPending) return <SkeletonRows rows={3} />;
  if (results.isError)
    return <PageError error={results.error} onRetry={() => void results.refetch()} />;

  const families = results.data.families;
  const students = results.data.students;
  if ((tab === 'families' ? families : students).length === 0) {
    return (
      <EmptyState
        Icon={Search}
        title={t('people.noResults', { q })}
        body={t('people.noResultsBody')}
        action={
          <Button variant="secondary" onClick={onClear}>
            {t('people.clearSearch')}
          </Button>
        }
      />
    );
  }

  const branch = (id: string) => (manyBranches ? branchName(id) : null);
  return (
    <ul className="divide-y divide-border">
      {tab === 'families'
        ? families.map((family) => (
            <RowLink key={family.id} to={paths.family(family.id)} grid="">
              <TwoLines
                title={t('people.familyName', { name: family.name })}
                meta={[
                  branch(family.branchId),
                  family.bankReference
                    ? t('people.bankReference', { ref: family.bankReference })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                className="flex-1"
              />
            </RowLink>
          ))
        : students.map((student) => {
            const name = `${student.firstName} ${student.lastName}`;
            return (
              <RowLink key={student.id} to={paths.student(student.id)} grid="">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={name} className="size-8 text-meta" />
                  <TwoLines
                    title={name}
                    meta={[
                      t('people.familyName', { name: student.familyName }),
                      student.dateOfBirth
                        ? t('people.age', { age: format.age(student.dateOfBirth) })
                        : null,
                      branch(student.branchId),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </span>
              </RowLink>
            );
          })}
    </ul>
  );
}
