import type {
  Class,
  Enrolment,
  EnrolmentUpdate,
  SearchResults,
  SearchStudent,
} from '@edustrux/shared';
import { addDays } from '@edustrux/shared/dates';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../components/PageState';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { useCourseLabel, useRefreshClasses } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { namesOf, query, useBranches, type Page } from '../../lib/people';

/** A refusal the API explains in words: full, already enrolled, outside the class's dates. */
function failure(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.status === 400 && Object.keys(err.fields).length) return null;
    if (err.status === 422 || err.status === 409 || err.status === 402) return err.message;
  }
  return errorMessage(err);
}

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Enrol a student in the class: find them by name, then choose the day they start. A full class
 * says so instead of offering to enrol (the API refuses it).
 */
export function EnrolDialog({ klass, onClose }: { klass: Class; onClose: () => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const refresh = useRefreshClasses();
  const branchName = namesOf(useBranches().data?.data);
  const manyBranches = (useBranches().data?.data.length ?? 0) > 1;
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [chosen, setChosen] = useState<SearchStudent | null>(null);
  // Today, or the class's first day when it hasn't begun.
  const firstDay =
    klass.startDate && klass.startDate > format.today ? klass.startDate : format.today;
  const [startDate, setStartDate] = useState(firstDay);
  const full = klass.capacity !== null && klass.enrolledCount >= klass.capacity;

  const results = useQuery({
    queryKey: ['search', membership.org.id, q, 20],
    queryFn: ({ signal }) =>
      api<SearchResults>('GET', orgApiPath(membership, `/search${query({ q, limit: 20 })}`), {
        signal,
      }),
    enabled: q.length > 0,
  });
  const enrolled = useQuery({
    queryKey: ['enrolments', membership.org.id, { classId: klass.id }],
    queryFn: ({ signal }) =>
      api<Page<Enrolment>>(
        'GET',
        orgApiPath(membership, `/enrolments${query({ classId: klass.id, limit: 200 })}`),
        { signal },
      ),
  });
  const already = new Set(
    (enrolled.data?.data ?? []).filter((e) => e.status === 'active').map((e) => e.studentId),
  );

  const save = useMutation({
    mutationFn: () =>
      api<Enrolment>('POST', orgApiPath(membership, '/enrolments'), {
        body: { studentId: chosen!.id, classId: klass.id, startDate },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('classes.enrol.done', { name: `${chosen!.firstName} ${chosen!.lastName}` }));
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const message = failure(save.error);
  const students = results.data?.students ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('classes.enrol.title')}
      subtitle={klass.name}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!chosen || full} loading={save.isPending} onClick={() => save.mutate()}>
            {t('classes.enrol.action')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {full ? (
          <Notice tone="warning">
            {t('classes.enrol.full', { capacity: klass.capacity ?? 0 })}
          </Notice>
        ) : null}
        <label className="flex h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-subtle focus-within:outline-2 focus-within:outline-brand sm:h-10">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('classes.enrol.search')}
            aria-label={t('classes.enrol.search')}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
          />
        </label>
        <div className="max-h-[240px] min-h-[120px] overflow-y-auto rounded-lg border border-border">
          {!q ? (
            <p className="px-4 py-5 text-body text-muted">{t('classes.enrol.hint')}</p>
          ) : results.isPending ? (
            <p className="px-4 py-5 text-body text-muted">{t('common.loading')}</p>
          ) : students.length === 0 ? (
            <p className="px-4 py-5 text-body text-muted">{t('classes.enrol.none', { q })}</p>
          ) : (
            <ul
              role="listbox"
              aria-label={t('classes.enrol.results')}
              className="divide-y divide-border"
            >
              {students.map((student) => {
                const name = `${student.firstName} ${student.lastName}`;
                const isIn = already.has(student.id);
                const selected = chosen?.id === student.id;
                return (
                  <li key={student.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={isIn}
                      onClick={() => setChosen(student)}
                      className={cn(
                        'flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left',
                        selected ? 'bg-brand-soft' : 'hover:bg-canvas',
                        isIn && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <Avatar name={name} className="size-8 text-meta" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate text-body font-semibold text-text">{name}</b>
                        <small className="truncate text-meta text-muted">
                          {[
                            t('people.familyName', { name: student.familyName }),
                            manyBranches ? branchName(student.branchId) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      {isIn ? (
                        <span className="text-meta text-muted">{t('classes.enrol.already')}</span>
                      ) : selected ? (
                        <Check className="size-4 text-brand" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <TextField
          label={t('classes.enrol.startDate')}
          type="date"
          required
          value={startDate}
          min={klass.startDate ?? undefined}
          max={klass.endDate ?? undefined}
          error={errors.startDate}
          helper={t('classes.enrol.startHelp')}
          onChange={(e) => setStartDate(e.target.value)}
        />
        {message ? <Notice tone="danger">{message}</Notice> : null}
      </div>
    </Dialog>
  );
}

/** Withdraw a student: their last day in the class, today unless another is chosen. */
export function WithdrawDialog({
  enrolment,
  onClose,
}: {
  enrolment: Enrolment;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const refresh = useRefreshClasses();
  const name = `${enrolment.studentFirstName} ${enrolment.studentLastName}`;
  // Someone who hasn't started yet leaves before their first day: they never start.
  const notStarted = enrolment.startDate > format.today;
  const [endDate, setEndDate] = useState(
    notStarted ? addDays(enrolment.startDate, -1) : format.today,
  );
  const save = useMutation({
    mutationFn: () =>
      api<EnrolmentUpdate>('PATCH', orgApiPath(membership, `/enrolments/${enrolment.id}`), {
        body: { updatedAt: enrolment.updatedAt, status: 'withdrawn', endDate },
      }),
    onSuccess: async (result) => {
      await refresh();
      const fixed = result.invoices.filter((i) => !i.adjusted).length;
      toast(
        fixed ? t('classes.withdraw.doneIssued', { name }) : t('classes.withdraw.done', { name }),
      );
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const message = failure(save.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('classes.withdraw.title', { name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>
            {t('classes.withdraw.action')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-text">{t('classes.withdraw.body')}</p>
        {notStarted ? (
          <Notice tone="info">{t('classes.withdraw.notStarted')}</Notice>
        ) : (
          <TextField
            label={t('classes.withdraw.lastDay')}
            type="date"
            required
            value={endDate}
            min={addDays(enrolment.startDate, -1)}
            error={errors.endDate}
            helper={t('classes.withdraw.lastDayHelp')}
            onChange={(e) => setEndDate(e.target.value)}
          />
        )}
        {message ? <Notice tone="danger">{message}</Notice> : null}
      </div>
    </Dialog>
  );
}

/** Move a student to another class: the old place ends the day before the new one starts. */
export function TransferDialog({
  klass,
  enrolment,
  onClose,
}: {
  klass: Class;
  enrolment: Enrolment;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const refresh = useRefreshClasses();
  const courseLabel = useCourseLabel();
  const name = `${enrolment.studentFirstName} ${enrolment.studentLastName}`;
  const [classId, setClassId] = useState('');
  const [startDate, setStartDate] = useState(format.today);
  // The other classes of the branch, the same course's first.
  const classes = useQuery({
    queryKey: ['classes', membership.org.id, { branchId: klass.branchId, all: true }],
    queryFn: ({ signal }) =>
      api<Page<Class>>(
        'GET',
        orgApiPath(membership, `/classes${query({ branchId: klass.branchId, limit: 200 })}`),
        { signal },
      ),
  });
  const choices = (classes.data?.data ?? [])
    .filter((c) => c.id !== klass.id && (c.endDate === null || c.endDate >= format.today))
    .sort(
      (a, b) =>
        Number(b.courseId === klass.courseId) - Number(a.courseId === klass.courseId) ||
        a.name.localeCompare(b.name),
    );
  const target = choices.find((c) => c.id === classId);
  const full = target && target.capacity !== null && target.enrolledCount >= target.capacity;

  const save = useMutation({
    mutationFn: () =>
      api<EnrolmentUpdate>('PATCH', orgApiPath(membership, `/enrolments/${enrolment.id}`), {
        body: { updatedAt: enrolment.updatedAt, transfer: { classId, startDate } },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('classes.transfer.done', { name, class: target?.name ?? '' }));
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const message = failure(save.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('classes.transfer.title', { name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!classId || full}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('classes.transfer.action')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          label={t('classes.transfer.to')}
          required
          value={classId}
          error={errors['transfer.classId']}
          onChange={(e) => setClassId(e.target.value)}
          options={[
            { value: '', label: t('classes.field.choose') },
            ...choices.map((c) => ({
              value: c.id,
              label: t('classes.transfer.option', {
                name: c.name,
                course: courseLabel(c.courseId),
                places:
                  c.capacity === null
                    ? String(c.enrolledCount)
                    : t('classes.capacity', { n: c.enrolledCount, capacity: c.capacity }),
              }),
            })),
          ]}
        />
        {full ? <Notice tone="warning">{t('classes.transfer.full')}</Notice> : null}
        <TextField
          label={t('classes.transfer.startDate')}
          type="date"
          required
          value={startDate}
          error={errors['transfer.startDate']}
          helper={t('classes.transfer.startHelp')}
          onChange={(e) => setStartDate(e.target.value)}
        />
        {message ? <Notice tone="danger">{message}</Notice> : null}
      </div>
    </Dialog>
  );
}
