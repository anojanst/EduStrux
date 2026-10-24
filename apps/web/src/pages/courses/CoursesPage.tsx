import type { Course, GradeLevel, Subject } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, GraduationCap, Layers, Plus, Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError, PageHeader, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import {
  useClassPaths,
  useCourseLabel,
  useCourses,
  useRefreshCurriculum,
  useSubjects,
} from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { namesOf, useGradeLevels, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { EmptyState, SkeletonRows } from '../people/parts';
import { CourseDialog } from './CourseDialog';

type Tab = 'courses' | 'subjects' | 'grades';
const TABS: Tab[] = ['courses', 'subjects', 'grades'];

/** What a dialog on this page is open for. */
type Open =
  | { kind: 'course'; course?: Course }
  | { kind: 'deleteCourse'; course: Course }
  | { kind: 'subject'; subject?: Subject }
  | { kind: 'deleteSubject'; subject: Subject }
  | { kind: 'grade'; grade?: GradeLevel }
  | { kind: 'deleteGrade'; grade: GradeLevel }
  | null;

/**
 * Settings › Courses (TUI-113): the org's courses, subjects and grade levels. Those who change
 * classes (`classes:write`) add and change courses; only the owner (`org:write`) changes subjects
 * and grade levels, and sets a course's default price (D-111).
 */
export function CoursesPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'classes:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Courses />;
}

/** "3 courses", "1 course" or "No courses". */
function coursesCount(n: number) {
  return n === 0
    ? t('courses.count.none')
    : t(n === 1 ? 'courses.count.one' : 'courses.count', { n });
}

function Courses() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Open>(null);
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'courses';
  const ownsNames = can(membership.role, 'org:write');

  const courses = useCourses();
  const subjects = useSubjects();
  const grades = useGradeLevels();
  const courseList = courses.data?.data ?? [];
  const gradesUsed = new Set(courseList.map((c) => c.gradeLevelId)).size;
  const close = () => setOpen(null);

  const action =
    tab === 'courses' ? (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'course' })}>
        {t('courses.add')}
      </Button>
    ) : !ownsNames ? null : tab === 'subjects' ? (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'subject' })}>
        {t('courses.subjects.add')}
      </Button>
    ) : (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'grade' })}>
        {t('courses.grades.add')}
      </Button>
    );

  return (
    <>
      <PageHeader
        overline={t('courses.overline')}
        title={t('courses.title')}
        subtitle={
          courseList.length
            ? t(gradesUsed === 1 ? 'courses.subtitle.oneGrade' : 'courses.subtitle', {
                courses: coursesCount(courseList.length).toLowerCase(),
                grades: gradesUsed,
              })
            : t('courses.subtitle.empty')
        }
        action={action}
      />

      <div role="tablist" className="mb-4 flex gap-6 border-b border-border">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setParams(name === 'courses' ? {} : { tab: name }, { replace: true })}
            className={cn(
              '-mb-px h-11 border-b-2 px-0.5 text-body',
              tab === name
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(`courses.tab.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'courses' ? (
        <CoursesTab
          onAdd={() => setOpen({ kind: 'course' })}
          onEdit={(course) => setOpen({ kind: 'course', course })}
          onDelete={(course) => setOpen({ kind: 'deleteCourse', course })}
        />
      ) : tab === 'subjects' ? (
        <NamesTab
          query={subjects}
          courseCount={(id) => courseList.filter((c) => c.subjectId === id).length}
          Icon={BookOpen}
          empty={t('courses.subjects.empty')}
          canChange={ownsNames}
          onAdd={() => setOpen({ kind: 'subject' })}
          addLabel={t('courses.subjects.add')}
          menuLabel={(name) => t('courses.subjects.actions', { name })}
          onRename={(subject) => setOpen({ kind: 'subject', subject })}
          onDelete={(subject) => setOpen({ kind: 'deleteSubject', subject })}
        />
      ) : (
        <NamesTab
          query={grades}
          ordered
          courseCount={(id) => courseList.filter((c) => c.gradeLevelId === id).length}
          Icon={GraduationCap}
          empty={t('courses.grades.empty')}
          canChange={ownsNames}
          onAdd={() => setOpen({ kind: 'grade' })}
          addLabel={t('courses.grades.add')}
          menuLabel={(name) => t('courses.grades.actions', { name })}
          onRename={(grade) => setOpen({ kind: 'grade', grade })}
          onDelete={(grade) => setOpen({ kind: 'deleteGrade', grade })}
        />
      )}

      <CourseDialog
        open={open?.kind === 'course'}
        onClose={close}
        course={open?.kind === 'course' ? open.course : undefined}
      />
      {open?.kind === 'subject' ? (
        <NameDialog
          title={open.subject ? t('courses.subjects.rename') : t('courses.subjects.add')}
          label={t('courses.field.subject')}
          placeholder={t('courses.field.subjectPlaceholder')}
          path={open.subject ? `/subjects/${open.subject.id}` : '/subjects'}
          item={open.subject}
          saved={open.subject ? t('courses.subjects.renamed') : t('courses.subjects.added')}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'grade' ? (
        <NameDialog
          title={open.grade ? t('courses.grades.rename') : t('courses.grades.add')}
          label={t('courses.field.grade')}
          placeholder={t('courses.field.gradePlaceholder')}
          path={open.grade ? `/grade-levels/${open.grade.id}` : '/grade-levels'}
          item={open.grade}
          saved={open.grade ? t('courses.grades.renamed') : t('courses.grades.added')}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteCourse' ? <DeleteCourse course={open.course} onClose={close} /> : null}
      {open?.kind === 'deleteSubject' ? (
        <DeleteDialog
          name={open.subject.name}
          path={`/subjects/${open.subject.id}`}
          blocked={blockedBy(
            courseList.filter((c) => c.subjectId === open.subject.id).length,
            'subject',
          )}
          deleted={t('courses.subjects.deleted')}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteGrade' ? (
        <DeleteDialog
          name={open.grade.name}
          path={`/grade-levels/${open.grade.id}`}
          blocked={blockedBy(
            courseList.filter((c) => c.gradeLevelId === open.grade.id).length,
            'grade',
          )}
          deleted={t('courses.grades.deleted')}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** Why a subject or grade level can't be deleted yet: its courses. */
function blockedBy(courses: number, what: 'subject' | 'grade') {
  if (courses === 0) return undefined;
  const n = coursesCount(courses).toLowerCase();
  return what === 'subject'
    ? t('courses.subjects.inUse', { courses: n })
    : t('courses.grades.inUse', { courses: n });
}

// ── Courses ─────────────────────────────────────────────────────────────────

const GRID =
  'md:grid md:grid-cols-[minmax(220px,2fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(140px,1fr)_44px]';

function CoursesTab({
  onAdd,
  onEdit,
  onDelete,
}: {
  onAdd: () => void;
  onEdit: (course: Course) => void;
  onDelete: (course: Course) => void;
}) {
  const format = useFormat();
  const courses = useCourses();
  const subjects = useSubjects();
  const grades = useGradeLevels();
  const subjectName = namesOf(subjects.data?.data);
  const [subjectId, setSubjectId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [typed, setTyped] = useState('');

  if (courses.isError) {
    return <PageError error={courses.error} onRetry={() => void courses.refetch()} />;
  }
  const list = courses.data?.data ?? [];
  const q = typed.trim().toLowerCase();
  const shown = list.filter(
    (c) =>
      (!subjectId || c.subjectId === subjectId) &&
      (!gradeId || c.gradeLevelId === gradeId) &&
      (!q ||
        `${subjectName(c.subjectId)} ${c.curriculum ?? ''} ${c.teachingMedium ?? ''}`
          .toLowerCase()
          .includes(q)),
  );
  // In grade order, with any course whose grade hasn't loaded at the end.
  const groups = [...(grades.data?.data ?? []), { id: '', name: '' }]
    .map((grade) => ({
      grade,
      rows: shown
        .filter((c) =>
          grade.id
            ? c.gradeLevelId === grade.id
            : !grades.data?.data.some((g) => g.id === c.gradeLevelId),
        )
        .sort(
          (a, b) =>
            subjectName(a.subjectId).localeCompare(subjectName(b.subjectId)) ||
            (a.curriculum ?? '').localeCompare(b.curriculum ?? ''),
        ),
    }))
    .filter((group) => group.rows.length > 0);
  const seesPrice = list.some((c) => c.defaultPrice !== undefined);
  const price = (course: Course) =>
    course.defaultPrice
      ? t('courses.perTerm', { price: format.money(course.defaultPrice) })
      : t('courses.noPrice');

  return (
    <>
      {list.length > 0 ? (
        <div className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              Icon={BookOpen}
              label={t('courses.field.subject')}
              value={subjectId}
              onChange={setSubjectId}
              options={[
                { value: '', label: t('courses.filter.all') },
                ...(subjects.data?.data ?? []).map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterSelect
              Icon={Layers}
              label={t('courses.field.grade')}
              value={gradeId}
              onChange={setGradeId}
              options={[
                { value: '', label: t('courses.filter.all') },
                ...(grades.data?.data ?? []).map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          </div>
          <label className="flex h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-subtle focus-within:outline-2 focus-within:outline-brand sm:h-10 lg:w-[260px]">
            <Search className="size-4 shrink-0" aria-hidden />
            <input
              type="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('courses.search')}
              aria-label={t('courses.search')}
              className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
            />
          </label>
        </div>
      ) : null}

      <Card flush className="overflow-hidden">
        {courses.isPending ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={BookOpen}
            title={t('courses.empty')}
            body={t('courses.empty.body')}
            action={
              <Button icon={<Plus className="size-4" />} onClick={onAdd}>
                {t('courses.add')}
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState Icon={BookOpen} title={t('courses.empty.filtered')} />
        ) : (
          <>
            <div
              aria-hidden
              className={cn(
                'hidden h-[42px] items-center gap-4 border-b border-border bg-[#fafbfb] px-4 text-meta font-semibold text-muted',
                GRID,
              )}
            >
              <span>{t('courses.col.course')}</span>
              <span>{t('courses.col.classes')}</span>
              <span>{t('courses.col.length')}</span>
              <span>{seesPrice ? t('courses.col.price') : null}</span>
              <span />
            </div>
            {groups.map(({ grade, rows }) => (
              <section key={grade.id} aria-label={grade.name || t('courses.otherGrade')}>
                <h3 className="flex h-9 items-center border-b border-border bg-brand-soft/60 px-4 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
                  {t('courses.group', {
                    grade: grade.name || t('courses.otherGrade'),
                    courses: coursesCount(rows.length),
                  })}
                </h3>
                <ul className="divide-y divide-border border-b border-border last:border-b-0">
                  {rows.map((course) => {
                    const detail = [course.curriculum, course.teachingMedium]
                      .filter(Boolean)
                      .join(' · ');
                    const classes = classesCount(course.classCount ?? 0);
                    const length = course.durationMinutes
                      ? t('courses.minutes', { n: course.durationMinutes })
                      : null;
                    return (
                      <li
                        key={course.id}
                        className={cn(
                          'flex min-h-[56px] items-center gap-3 py-2 pr-2 pl-4 text-body text-text md:gap-4',
                          GRID,
                        )}
                      >
                        <span className="flex min-w-0 flex-1 flex-col md:flex-none">
                          <b className="truncate font-semibold">{subjectName(course.subjectId)}</b>
                          {detail ? (
                            <small className="truncate text-meta text-muted">{detail}</small>
                          ) : null}
                          {/* On phones the columns are a meta line. */}
                          <small className="truncate text-meta text-muted md:hidden">
                            {[classes, length, seesPrice ? price(course) : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                        <span
                          className={cn('hidden md:block', !course.classCount && 'text-subtle')}
                        >
                          {classes}
                        </span>
                        <span className={cn('hidden md:block', !length && 'text-subtle')}>
                          {length ?? '—'}
                        </span>
                        <span
                          className={cn('hidden md:block', !course.defaultPrice && 'text-subtle')}
                        >
                          {seesPrice ? price(course) : null}
                        </span>
                        <OverflowMenu
                          label={t('courses.actions', {
                            // With the curriculum and medium, so two courses of a subject differ.
                            name: [`${grade.name} ${subjectName(course.subjectId)}`.trim(), detail]
                              .filter(Boolean)
                              .join(' · '),
                          })}
                          items={[
                            { label: t('courses.menu.edit'), onSelect: () => onEdit(course) },
                            {
                              label: t('courses.menu.delete'),
                              onSelect: () => onDelete(course),
                              danger: true,
                            },
                          ]}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </Card>
    </>
  );
}

/** "4 classes", "1 class" or "No classes". */
function classesCount(n: number) {
  return n === 0
    ? t('courses.classes.none')
    : t(n === 1 ? 'courses.classes.one' : 'courses.classes', { n });
}

// ── Subjects and grade levels ───────────────────────────────────────────────

type Named = { id: string; name: string; updatedAt: string };

/**
 * The subjects, or the grade levels in their order: each with how many courses it has. The owner
 * renames, deletes and (for grade levels) moves them; others read them.
 */
function NamesTab<T extends Named>({
  query,
  ordered = false,
  courseCount,
  Icon,
  empty,
  canChange,
  onAdd,
  addLabel,
  menuLabel,
  onRename,
  onDelete,
}: {
  query: {
    data?: Page<T>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  ordered?: boolean;
  courseCount: (id: string) => number;
  Icon: typeof BookOpen;
  empty: string;
  canChange: boolean;
  onAdd: () => void;
  addLabel: string;
  menuLabel: (name: string) => string;
  onRename: (item: T) => void;
  onDelete: (item: T) => void;
}) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const list = query.data?.data ?? [];

  const move = useMutation({
    mutationFn: (ids: string[]) =>
      api<Page<GradeLevel>>('PUT', orgApiPath(membership, '/grade-levels/order'), {
        body: { ids },
      }),
    onSuccess: (result) => queryClient.setQueryData(['grade-levels', membership.org.id], result),
  });
  const moveTo = (from: number, to: number) => {
    const ids = list.map((item) => item.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    move.mutate(ids);
  };

  if (query.isError) {
    return <PageError error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="flex max-w-[600px] flex-col gap-4">
      {!canChange ? <Notice tone="info">{t('courses.ownerOnlyNames')}</Notice> : null}
      {move.error ? <Notice tone="danger">{errorMessage(move.error)}</Notice> : null}
      <Card flush className="overflow-hidden">
        {query.isPending ? (
          <SkeletonRows rows={3} />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={Icon}
            title={empty}
            action={
              canChange ? (
                <Button icon={<Plus className="size-4" />} onClick={onAdd}>
                  {addLabel}
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((item, i) => (
              <li key={item.id} className="flex min-h-[56px] items-center gap-2 py-2 pr-2 pl-4">
                {ordered && canChange ? (
                  <span className="-ml-2 flex shrink-0">
                    <MoveButton
                      label={t('courses.grades.moveUp', { name: item.name })}
                      disabled={i === 0 || move.isPending}
                      onClick={() => moveTo(i, i - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </MoveButton>
                    <MoveButton
                      label={t('courses.grades.moveDown', { name: item.name })}
                      disabled={i === list.length - 1 || move.isPending}
                      onClick={() => moveTo(i, i + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </MoveButton>
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-body font-semibold text-text">{item.name}</b>
                  <small className="text-meta text-muted">
                    {coursesCount(courseCount(item.id))}
                  </small>
                </span>
                {canChange ? (
                  <OverflowMenu
                    label={menuLabel(item.name)}
                    items={[
                      { label: t('courses.menu.rename'), onSelect: () => onRename(item) },
                      {
                        label: t('courses.menu.delete'),
                        onSelect: () => onDelete(item),
                        danger: true,
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-text disabled:pointer-events-none disabled:opacity-30 md:size-9"
    >
      {children}
    </button>
  );
}

/** Add a subject or grade level, or rename one. Names are unique in the org, ignoring case. */
function NameDialog({
  title,
  label,
  placeholder,
  path,
  item,
  saved,
  onClose,
}: {
  title: string;
  label: string;
  placeholder: string;
  path: string;
  item?: Named;
  saved: string;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCurriculum();
  const [name, setName] = useState(item?.name ?? '');
  const [missing, setMissing] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(item ? 'PATCH' : 'POST', orgApiPath(membership, path), {
        body: item ? { updatedAt: item.updatedAt, name: name.trim() } : { name: name.trim() },
      }),
    onSuccess: async () => {
      await refresh();
      toast(saved);
      onClose();
    },
  });
  // A name that's taken is said on the field, in the API's words.
  const taken = save.error instanceof ApiError && save.error.status === 409;
  const error = missing
    ? t('courses.error.required')
    : taken
      ? (save.error as ApiError).message
      : fieldErrors(save.error).name;
  const other =
    save.error && !taken && !fieldErrors(save.error).name ? errorMessage(save.error) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setMissing(!name.trim());
    if (name.trim()) save.mutate();
  }

  return (
    <Dialog open onClose={onClose} title={title}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={label}
          required
          maxLength={120}
          value={name}
          placeholder={placeholder}
          error={error}
          onChange={(e) => setName(e.target.value)}
        />
        {other ? <Notice tone="danger">{other}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t('courses.saveName')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteCourse({ course, onClose }: { course: Course; onClose: () => void }) {
  const courseLabel = useCourseLabel();
  const paths = useClassPaths();
  const n = course.classCount ?? 0;
  const label = [courseLabel(course.id), course.curriculum].filter(Boolean).join(' · ');
  return (
    <DeleteDialog
      name={label}
      path={`/courses/${course.id}`}
      blocked={
        n
          ? t('courses.inUse', {
              classes: classesCount(n).toLowerCase(),
            })
          : undefined
      }
      blockedLink={
        n ? (
          <Link
            to={`${paths.list}?term=all&course=${course.id}`}
            className="font-semibold underline"
          >
            {t('courses.viewClasses')}
          </Link>
        ) : null
      }
      deleted={t('courses.deleted')}
      onClose={onClose}
    />
  );
}

/**
 * "Delete … ?" for a course, subject or grade level. What still uses it is said up front, with
 * Delete off; the API refuses it too (422), and says why, if the lists were out of date.
 */
function DeleteDialog({
  name,
  path,
  blocked,
  blockedLink,
  deleted,
  onClose,
}: {
  name: string;
  path: string;
  blocked?: string;
  blockedLink?: ReactNode;
  deleted: string;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCurriculum();
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, path)),
    onSuccess: async () => {
      await refresh();
      toast(deleted);
      onClose();
    },
  });
  const refused =
    run.error instanceof ApiError && run.error.status === 422
      ? run.error.message
      : run.error
        ? errorMessage(run.error)
        : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('courses.delete.title', { name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={run.isPending}
            disabled={Boolean(blocked)}
            onClick={() => run.mutate()}
          >
            {t('courses.menu.delete')}
          </Button>
        </>
      }
    >
      <p className="text-body text-text">{t('courses.delete.body')}</p>
      {blocked || refused ? (
        <Notice tone="danger" className="mt-4">
          {blocked ?? refused} {blocked ? blockedLink : null}
        </Notice>
      ) : null}
    </Dialog>
  );
}
