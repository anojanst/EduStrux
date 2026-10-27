import type { Enrolment, InvoiceRunResult, InvoiceSkipReason, Job } from '@edustrux/shared';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { ChevronDown, CircleCheck, CircleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { t } from '../../i18n';
import { api, fieldErrors } from '../../lib/api';
import { useBillingPaths, useRefreshBilling } from '../../lib/billing';
import { currentTerm, useCoursesPath, useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, type Page } from '../../lib/people';
import { StaleOrError } from '../people/dialogs';

/**
 * Run invoices (TUI-119): make the drafts for a term, or for a month of the classes with no
 * term. The run is a job; the dialog follows it and shows what it made and what it left off.
 */
export function RunInvoicesDialog({
  open,
  termId,
  onClose,
}: {
  open: boolean;
  /** The term to start on, e.g. from Settings › Terms & holidays; else the current one. */
  termId?: string;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const close = () => {
    setJobId(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={t('billing.run.title')}
      subtitle={jobId ? undefined : t('billing.run.subtitle')}
    >
      {jobId ? (
        <RunProgress jobId={jobId} label={label} onClose={close} />
      ) : (
        <RunForm
          termId={termId}
          onClose={close}
          onStarted={(id, what) => {
            setLabel(what);
            setJobId(id);
          }}
        />
      )}
    </Dialog>
  );
}

function RunForm({
  termId: initialTerm,
  onClose,
  onStarted,
}: {
  termId?: string;
  onClose: () => void;
  onStarted: (jobId: string, label: string) => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const terms = useTerms();
  const termList = [...(terms.data?.data ?? [])].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const [kind, setKind] = useState<'term' | 'month'>('term');
  const [termId, setTermId] = useState(initialTerm ?? '');
  const [month, setMonth] = useState(format.today.slice(0, 7));
  const [dueDate, setDueDate] = useState('');
  const byTerm = kind === 'term' && termList.length > 0;
  const chosenTerm = termId || currentTerm(termList, format.today)?.id || '';

  const run = useMutation({
    mutationFn: () =>
      byTerm
        ? api<{ jobId: string }>(
            'POST',
            orgApiPath(membership, `/terms/${chosenTerm}/generate-invoices`),
            { body: dueDate ? { dueDate } : {} },
          )
        : api<{ jobId: string }>('POST', orgApiPath(membership, '/invoices/generate-monthly'), {
            body: { month, ...(dueDate ? { dueDate } : {}) },
          }),
    onSuccess: ({ jobId }) =>
      onStarted(
        jobId,
        byTerm ? (termList.find((x) => x.id === chosenTerm)?.name ?? '') : format.month(month),
      ),
  });
  const errors = fieldErrors(run.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    run.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {termList.length > 0 ? (
        <div
          role="radiogroup"
          aria-label={t('billing.run.kind')}
          className="grid grid-cols-2 gap-1 rounded-lg border border-border-strong p-1"
        >
          {(['term', 'month'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                'h-10 rounded-md text-label sm:h-9',
                kind === value
                  ? 'bg-brand-soft font-semibold text-brand'
                  : 'text-secondary-text hover:bg-canvas',
              )}
            >
              {t(`billing.run.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {byTerm ? (
        <SelectField
          label={t('billing.run.term')}
          required
          value={chosenTerm}
          onChange={(e) => setTermId(e.target.value)}
          options={termList.map((term) => ({
            value: term.id,
            label: t('billing.run.termOption', {
              name: term.name,
              start: format.date(term.startDate),
              end: format.date(term.endDate),
            }),
          }))}
        />
      ) : (
        <TextField
          label={t('billing.run.month')}
          type="month"
          required
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          helper={t('billing.run.monthHelp')}
          error={errors.month}
        />
      )}
      <TextField
        label={t('billing.run.due')}
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        helper={t('billing.run.dueHelp')}
        error={errors.dueDate}
      />
      <StaleOrError error={run.error} onReload={onClose} />
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={run.isPending} disabled={byTerm && !chosenTerm}>
          {t('billing.run.start')}
        </Button>
      </div>
    </form>
  );
}

/** Polls the run's job until it's done, then shows its result. */
function RunProgress({
  jobId,
  label,
  onClose,
}: {
  jobId: string;
  label: string;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshBilling();
  const job = useQuery({
    queryKey: ['job', membership.org.id, jobId],
    queryFn: async ({ signal }) => {
      const found = await api<Job>('GET', orgApiPath(membership, `/jobs/${jobId}`), { signal });
      if (found.status === 'succeeded') await refresh();
      return found;
    },
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'succeeded' || status === 'failed' ? false : 1000;
    },
  });

  const status = job.data?.status;
  if (status === 'succeeded') {
    return <RunResult result={job.data!.result as InvoiceRunResult} onClose={onClose} />;
  }
  if (status === 'failed' || job.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CircleAlert className="size-8 text-danger" aria-hidden />
        <p className="text-section font-medium">{t('billing.run.failed', { label })}</p>
        {job.data?.error ? <p className="text-meta text-muted">{job.data.error}</p> : null}
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    );
  }
  const progress = job.data?.progress ?? 0;
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <p className="text-section font-medium">{t('billing.run.running', { label })}</p>
      <div
        role="progressbar"
        aria-label={t('billing.run.running', { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-2 w-full max-w-[360px] overflow-hidden rounded-full bg-border"
      >
        <span
          className="block h-full rounded-full bg-brand transition-[width] duration-150"
          style={{ width: `${Math.max(8, progress)}%` }}
        />
      </div>
      <p className="text-meta text-muted">{t('billing.run.carriesOn')}</p>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t('common.close')}
      </Button>
    </div>
  );
}

const REASON_TONES: Record<InvoiceSkipReason, 'neutral' | 'warning' | 'info'> = {
  no_price: 'warning',
  no_lessons: 'neutral',
  free_trial: 'info',
  free: 'info',
  pack_covers: 'info',
  currency_mismatch: 'warning',
  other_branch: 'neutral',
};

function RunResult({ result, onClose }: { result: InvoiceRunResult; onClose: () => void }) {
  const { membership } = useOrg();
  const format = useFormat();
  const navigate = useNavigate();
  const paths = useBillingPaths();
  const coursesPath = useCoursesPath();
  const [showSkipped, setShowSkipped] = useState(false);

  // The run gives ids; the names come from the enrolments of the classes it left some off.
  const classIds = [...new Set(result.skipped.map((s) => s.classId))];
  const enrolments = useQueries({
    queries: classIds.map((classId) => ({
      queryKey: ['enrolments', membership.org.id, { classId }],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Page<Enrolment>>(
          'GET',
          orgApiPath(membership, `/enrolments${query({ classId, limit: 200 })}`),
          { signal },
        ),
      enabled: showSkipped,
    })),
  });
  const byId = new Map(enrolments.flatMap((q) => q.data?.data ?? []).map((e) => [e.id, e]));
  const period = result.termId ? 'term' : 'month';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-5" aria-hidden />
        </span>
        <p className="mt-1 text-section font-medium">
          {result.invoices === 1
            ? t('billing.run.madeOne')
            : t('billing.run.madeMany', { n: result.invoices })}
        </p>
        {result.invoices ? (
          <p className="text-body font-semibold tabular-nums">
            {t(result.lines === 1 ? 'billing.run.totalOne' : 'billing.run.totalMany', {
              total: format.money(result.total),
              n: result.lines,
            })}
          </p>
        ) : null}
        {result.alreadyInvoiced ? (
          <p className="text-meta text-muted">
            {t(`billing.run.already.${period}`, { n: result.alreadyInvoiced })}
          </p>
        ) : null}
      </div>

      {result.skipped.length ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <button
            type="button"
            aria-expanded={showSkipped}
            onClick={() => setShowSkipped((s) => !s)}
            className="flex h-11 w-full items-center gap-2 px-4 text-left text-label font-semibold text-text hover:bg-canvas"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', showSkipped ? null : '-rotate-90')}
              aria-hidden
            />
            {t('billing.run.leftOff', { n: result.skipped.length })}
          </button>
          {showSkipped ? (
            <ul className="divide-y divide-border border-t border-border">
              {result.skipped.map((skip) => {
                const enrolment = byId.get(skip.enrolmentId);
                return (
                  <li
                    key={skip.enrolmentId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <b className="text-body font-semibold text-text">
                        {enrolment
                          ? `${enrolment.studentFirstName} ${enrolment.studentLastName}`
                          : t('billing.run.aStudent')}
                      </b>
                      <small className="text-meta text-muted">{enrolment?.className ?? ''}</small>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={REASON_TONES[skip.reason]}>
                        {t(`billing.skip.${skip.reason}`)}
                      </Badge>
                      {skip.reason === 'no_price' && membership.role === 'owner' ? (
                        <Link
                          to={coursesPath()}
                          className="text-meta font-semibold whitespace-nowrap text-brand hover:underline"
                        >
                          {t('billing.run.setPrice')}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
        {result.invoices ? (
          <Button
            onClick={() => {
              onClose();
              navigate(`${paths.invoices}?status=draft`);
            }}
          >
            {t('billing.run.review')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
