import { addDays } from '@edustrux/shared/dates';
import type {
  Class,
  ConsentType,
  Enrolment,
  Family,
  Session,
  Student,
  StudentConsents,
} from '@edustrux/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  classColour,
  familyKey,
  guardianName,
  namesOf,
  query,
  studentKey,
  useAcademicYears,
  useBranches,
  useGradeLevels,
  usePeoplePaths,
  type Page,
} from '../../lib/people';
import { can } from '../../lib/roles';
import { ConfirmDialog, StudentDialog, useRefreshPeople } from './dialogs';
import { MakeupCard } from './makeups';
import { CardEmpty, DetailHeader, SectionCard } from './parts';

export function StudentPage() {
  const { membership } = useOrg();
  const { studentId = '' } = useParams();
  if (!can(membership.role, 'people:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <StudentDetail key={studentId} studentId={studentId} />;
}

type Open = { kind: 'edit' | 'delete' | 'notes' } | { kind: 'consent'; type: ConsentType } | null;

function StudentDetail({ studentId }: { studentId: string }) {
  const { membership } = useOrg();
  const navigate = useNavigate();
  const paths = usePeoplePaths();
  const format = useFormat();
  const refresh = useRefreshPeople();
  const branches = useBranches();
  const gradeName = namesOf(useGradeLevels().data?.data);
  const [open, setOpen] = useState<Open>(null);
  const canWrite = can(membership.role, 'people:write');
  const canClasses = can(membership.role, 'classes:read');

  const student = useQuery({
    queryKey: studentKey(membership.org.id, studentId),
    queryFn: ({ signal }) =>
      api<Student>('GET', orgApiPath(membership, `/students/${studentId}`), { signal }),
  });

  if (student.isPending) return <PageLoading />;
  if (student.isError)
    return <PageError error={student.error} onRetry={() => void student.refetch()} />;
  const data = student.data;
  const name = `${data.firstName} ${data.lastName}`;
  const close = () => setOpen(null);
  const grade = gradeName(data.gradeLevelId);

  return (
    <>
      <DetailHeader
        back={{
          to: paths.family(data.familyId),
          label: t('people.familyName', { name: data.familyName }),
        }}
        title={name}
        meta={[
          grade,
          data.dateOfBirth ? t('people.age', { age: format.age(data.dateOfBirth) }) : null,
          (branches.data?.data.length ?? 0) > 1
            ? t('people.branchName', { name: namesOf(branches.data?.data)(data.branchId) })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" onClick={() => setOpen({ kind: 'edit' })}>
                {t('people.edit')}
              </Button>
              <OverflowMenu
                label={t('people.moreActions')}
                items={[
                  {
                    label: t('people.deleteStudent.menu'),
                    onSelect: () => setOpen({ kind: 'delete' }),
                    danger: true,
                  },
                ]}
              />
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {canClasses ? (
            <>
              <ClassesCard studentId={data.id} />
              <LessonsCard studentId={data.id} />
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {canClasses ? <MakeupCard student={data} /> : null}
          <GradesCard student={data} />
          <ConsentsCard
            student={data}
            onChange={canWrite ? (type) => setOpen({ kind: 'consent', type }) : undefined}
          />
          {data.notes !== undefined ? (
            <SectionCard
              title={t('people.notes')}
              action={
                canWrite ? (
                  <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: 'notes' })}>
                    {t('people.edit')}
                  </Button>
                ) : null
              }
            >
              {data.notes ? (
                <p className="px-4 py-3.5 text-body whitespace-pre-line text-text">{data.notes}</p>
              ) : (
                <CardEmpty>{t('people.noNotes')}</CardEmpty>
              )}
            </SectionCard>
          ) : null}
        </div>
      </div>

      <StudentDialog
        family={{ id: data.familyId, name: data.familyName }}
        student={data}
        open={open?.kind === 'edit'}
        onClose={close}
      />
      {open?.kind === 'delete' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={t('people.deleteStudent.title', { name })}
          body={t('people.deleteStudent.body')}
          action={t('people.deleteStudent.action')}
          onConfirm={async () => {
            await api('DELETE', orgApiPath(membership, `/students/${data.id}`));
            navigate(paths.family(data.familyId), { replace: true });
            await refresh();
          }}
        />
      ) : null}
      {open?.kind === 'notes' ? <NotesDialog student={data} onClose={close} /> : null}
      {open?.kind === 'consent' ? (
        <ConsentDialog student={data} type={open.type} onClose={close} />
      ) : null}
    </>
  );
}

function ClassesCard({ studentId }: { studentId: string }) {
  const { membership } = useOrg();
  const format = useFormat();
  const enrolments = useQuery({
    queryKey: ['enrolments', membership.org.id, { studentId }],
    queryFn: ({ signal }) =>
      api<Page<Enrolment>>(
        'GET',
        orgApiPath(membership, `/enrolments${query({ studentId, limit: 200 })}`),
        { signal },
      ),
  });
  const list = [...(enrolments.data?.data ?? [])].sort(
    (a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'),
  );
  const classIds = [...new Set(list.map((e) => e.classId))];
  const classes = useQueries({
    queries: classIds.map((classId) => ({
      queryKey: ['class', membership.org.id, classId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Class>('GET', orgApiPath(membership, `/classes/${classId}`), { signal }),
      staleTime: 60_000,
    })),
  });
  const classOf = new Map(classes.flatMap((c) => (c.data ? [[c.data.id, c.data]] : [])));

  return (
    <SectionCard title={t('people.classes')}>
      {enrolments.isPending ? (
        <div className="h-16 animate-pulse bg-canvas/60" aria-hidden />
      ) : enrolments.isError ? (
        <CardEmpty>{errorMessage(enrolments.error)}</CardEmpty>
      ) : list.length === 0 ? (
        <CardEmpty>{t('people.noClasses')}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((enrolment) => {
            const slots = classOf.get(enrolment.classId)?.schedule ?? [];
            const when = slots
              .map(
                (s) => `${format.weekday(s.weekday)} ${format.timeRange(s.startTime, s.endTime)}`,
              )
              .join(' · ');
            const active = enrolment.status === 'active';
            return (
              <li key={enrolment.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="h-9 w-[3px] shrink-0 rounded-full"
                  style={{ background: classColour(enrolment.classId) }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-body font-semibold text-text">
                    {enrolment.className}
                  </b>
                  <small className="text-meta text-muted">
                    {[
                      when,
                      enrolment.endDate
                        ? t('people.until', { date: format.date(enrolment.endDate) })
                        : enrolment.startDate > format.today
                          ? t('people.from', { date: format.date(enrolment.startDate) })
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <Badge tone={active ? 'success' : 'neutral'}>
                  {active ? t('people.enrolment.active') : t('people.enrolment.withdrawn')}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/** The next lessons in the student's timetable: the next six weeks, at most five. */
function LessonsCard({ studentId }: { studentId: string }) {
  const { membership } = useOrg();
  const format = useFormat();
  const from = format.today;
  const to = addDays(from, 41);
  const sessions = useQuery({
    queryKey: ['sessions', membership.org.id, { studentId, from, to }],
    queryFn: ({ signal }) =>
      api<Page<Session>>(
        'GET',
        orgApiPath(membership, `/sessions${query({ studentId, from, to, limit: 5 })}`),
        { signal },
      ),
  });
  const list = sessions.data?.data ?? [];

  return (
    <SectionCard title={t('people.upcoming')}>
      {sessions.isPending ? (
        <div className="h-16 animate-pulse bg-canvas/60" aria-hidden />
      ) : sessions.isError ? (
        <CardEmpty>{errorMessage(sessions.error)}</CardEmpty>
      ) : list.length === 0 ? (
        <CardEmpty>{t('people.noLessons')}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((session) => {
            const cancelled = session.status === 'cancelled';
            return (
              <li
                key={session.id}
                className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-0.5 px-4 py-3 sm:grid-cols-[96px_150px_1fr_auto]"
              >
                <b className="text-body font-semibold text-text">{format.day(session.date)}</b>
                <span className="text-body text-muted tabular-nums">
                  {format.timeRange(session.startTime, session.endTime)}
                </span>
                <span
                  className={cn(
                    'col-span-2 min-w-0 truncate text-body text-text sm:col-span-1',
                    cancelled && 'text-muted line-through',
                  )}
                >
                  {session.className}
                </span>
                {cancelled ? (
                  <span className="col-span-2 sm:col-span-1">
                    <Badge tone="danger">{t('people.lesson.cancelled')}</Badge>
                  </span>
                ) : session.movedFrom ? (
                  <span className="col-span-2 sm:col-span-1">
                    <Badge tone="warning">
                      {t('people.lesson.moved', {
                        when: `${format.day(session.movedFrom.date)} ${format.time(session.movedFrom.startTime)}`,
                      })}
                    </Badge>
                  </span>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function GradesCard({ student }: { student: Student }) {
  const years = useAcademicYears();
  const gradeName = namesOf(useGradeLevels().data?.data);
  const yearName = namesOf(years.data?.data);
  const history = [...student.grades].reverse();
  return (
    <SectionCard title={t('people.gradeHistory')}>
      {history.length === 0 ? (
        <CardEmpty>{t('people.noGrades')}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {history.map((g) => (
            <li key={g.academicYearId} className="flex justify-between gap-3 px-4 py-3 text-body">
              <span className="text-text">{gradeName(g.gradeLevelId)}</span>
              <b className="font-semibold text-muted">{yearName(g.academicYearId)}</b>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function consentsKey(orgId: string, studentId: string) {
  return ['consents', orgId, studentId];
}

function ConsentsCard({
  student,
  onChange,
}: {
  student: Student;
  onChange?: (type: ConsentType) => void;
}) {
  const { membership } = useOrg();
  const consents = useQuery({
    queryKey: consentsKey(membership.org.id, student.id),
    queryFn: ({ signal }) =>
      api<StudentConsents>('GET', orgApiPath(membership, `/students/${student.id}/consents`), {
        signal,
      }),
  });

  return (
    <SectionCard title={t('people.consents')}>
      {consents.isPending ? (
        <div className="h-16 animate-pulse bg-canvas/60" aria-hidden />
      ) : consents.isError ? (
        <CardEmpty>{errorMessage(consents.error)}</CardEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {consents.data.consents.map((consent) => (
            <li key={consent.type} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-body text-text">
                {t(`people.consent.${consent.type}`)}
              </span>
              <Badge
                tone={consent.granted === null ? 'neutral' : consent.granted ? 'success' : 'danger'}
              >
                {consent.granted === null
                  ? t('people.consent.notAsked')
                  : consent.granted
                    ? t('people.consent.granted')
                    : t('people.consent.refused')}
              </Badge>
              {onChange ? (
                <button
                  type="button"
                  className="text-label font-medium text-brand hover:underline"
                  aria-label={t('people.consent.changeLabel', {
                    consent: t(`people.consent.${consent.type}`),
                  })}
                  onClick={() => onChange(consent.type)}
                >
                  {t('people.consent.change')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ConsentDialog({
  student,
  type,
  onClose,
}: {
  student: Student;
  type: ConsentType;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const family = useQuery({
    queryKey: familyKey(membership.org.id, student.familyId),
    queryFn: ({ signal }) =>
      api<Family>('GET', orgApiPath(membership, `/families/${student.familyId}`), { signal }),
  });
  // Starts from what is recorded now, read by the card behind the dialog.
  const current = useQueryClient()
    .getQueryData<StudentConsents>(consentsKey(membership.org.id, student.id))
    ?.consents.find((c) => c.type === type);
  const [granted, setGranted] = useState<'yes' | 'no' | ''>(
    current?.granted === true ? 'yes' : current?.granted === false ? 'no' : '',
  );
  const [guardianId, setGuardianId] = useState(current?.guardianId ?? '');
  const [note, setNote] = useState(current?.note ?? '');
  const save = useMutation({
    mutationFn: () =>
      api('PUT', orgApiPath(membership, `/students/${student.id}/consents/${type}`), {
        body: {
          granted: granted === 'yes',
          guardianId: guardianId || null,
          note: note.trim() || null,
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('people.saved'));
      onClose();
    },
  });
  const consentName = t(`people.consent.${type}`);

  return (
    <Dialog open onClose={onClose} title={t('people.consent.title', { consent: consentName })}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (granted) save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-text">
            {t('people.consent.answer', { name: student.firstName })}
          </legend>
          {(['yes', 'no'] as const).map((value) => (
            <label
              key={value}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-strong px-3 text-body has-checked:border-brand has-checked:bg-brand-soft"
            >
              <input
                type="radio"
                name="granted"
                value={value}
                checked={granted === value}
                onChange={() => setGranted(value)}
                className="size-4 accent-[var(--brand)]"
              />
              {value === 'yes' ? t('people.consent.granted') : t('people.consent.refused')}
            </label>
          ))}
        </fieldset>
        {(family.data?.guardians.length ?? 0) > 0 ? (
          <SelectField
            label={t('people.consent.by')}
            value={guardianId}
            onChange={(e) => setGuardianId(e.target.value)}
            options={[
              { value: '', label: t('people.consent.byNobody') },
              ...family.data!.guardians.map((g) => ({ value: g.id, label: guardianName(g) })),
            ]}
          />
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-text">{t('people.consent.note')}</span>
          <textarea
            value={note}
            maxLength={500}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-border-strong px-3 py-2 text-body focus:outline-2 focus:outline-brand"
          />
        </label>
        {save.error ? <Notice tone="danger">{errorMessage(save.error)}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!granted} loading={save.isPending}>
            {t('people.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NotesDialog({ student, onClose }: { student: Student; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshPeople();
  const toast = useToast();
  const [notes, setNotes] = useState(student.notes ?? '');
  const save = useMutation({
    mutationFn: () =>
      api('PATCH', orgApiPath(membership, `/students/${student.id}`), {
        body: { updatedAt: student.updatedAt, notes: notes.trim() || null },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('people.saved'));
      onClose();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'stale_data';

  return (
    <Dialog open onClose={onClose} title={t('people.notes')}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-text">{t('people.notes')}</span>
          <textarea
            value={notes}
            maxLength={2000}
            rows={6}
            autoFocus
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-border-strong px-3 py-2 text-body focus:outline-2 focus:outline-brand"
          />
          <span className="text-meta text-muted">{t('people.notesHelp')}</span>
        </label>
        {save.error ? (
          <Notice
            tone="danger"
            action={
              stale ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void refresh();
                    onClose();
                  }}
                >
                  {t('people.reload')}
                </Button>
              ) : null
            }
          >
            {errorMessage(save.error)}
          </Notice>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t('people.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
