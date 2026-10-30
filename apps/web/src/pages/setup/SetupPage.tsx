import type { AcademicYear, GradeLevel, Org, Subject, TaxRate, Term } from '@edustrux/shared';
import { localNow } from '@edustrux/shared/dates';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageError, PageHeader, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { t, type MessageKey } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  useAllClasses,
  useCourses,
  useCoursesPath,
  useSubjects,
  useTerms,
} from '../../lib/classes';
import { orgApiPath, useOrg } from '../../lib/org';
import { useAcademicYears, useGradeLevels } from '../../lib/people';
import { parsePercent, percentLabel, useTaxRates } from '../../lib/pricing';
import { can } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { ClassDialog } from '../classes/ClassDialog';
import { Toggle } from '../people/Toggle';
import {
  GRADE_PRESETS,
  gradePresetFor,
  STARTING_SUBJECTS,
  SUBJECTS,
  taxNameFor,
  type GradePreset,
} from './presets';

const STEPS = ['calendar', 'grades', 'subjects', 'tax', 'class'] as const;
type Step = (typeof STEPS)[number];

/**
 * The setup wizard (TUI-64): after `POST /orgs`, the owner is walked through the term calendar,
 * grade levels, subjects, tax and a first class, one step a page. Each step can be skipped and
 * the wizard opened again from Home; a step counts as done once its data exists, so the wizard
 * keeps no state of its own. Every save is one of the settings screens' own calls.
 */
export function SetupPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'org:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <SetupWizard />;
}

function useProgress() {
  const years = useAcademicYears();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const taxRates = useTaxRates();
  const classes = useAllClasses();
  const queries = [years, grades, subjects, taxRates, classes];
  return {
    loading: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error,
    done: {
      calendar: Boolean(years.data?.data.length),
      grades: Boolean(grades.data?.data.length),
      subjects: Boolean(subjects.data?.data.length),
      tax: Boolean(taxRates.data?.length),
      class: Boolean(classes.data?.data.length),
    } satisfies Record<Step, boolean>,
  };
}

function SetupWizard() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const progress = useProgress();
  const navigate = useNavigate();
  const asked = params.get('step') as Step;
  const step: Step = STEPS.includes(asked) ? asked : 'calendar';
  const index = STEPS.indexOf(step);
  const home = orgPath(membership.org.slug);

  const go = (next: Step) => setParams({ step: next });
  const next = () => (index + 1 < STEPS.length ? go(STEPS[index + 1]!) : navigate(home));
  const back = index > 0 ? () => go(STEPS[index - 1]!) : undefined;

  if (progress.error) return <PageError error={progress.error} />;
  if (progress.loading) return <PageLoading />;

  const props = { done: progress.done[step], next, back };
  return (
    <div className="max-w-4xl">
      <PageHeader
        overline={t('setup.overline', { n: index + 1, total: STEPS.length })}
        title={t(`setup.${step}.title`)}
        subtitle={t(`setup.${step}.subtitle`)}
      />
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <nav aria-label={t('setup.steps')} className="hidden w-52 shrink-0 md:block">
          <ol className="flex flex-col gap-1">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => go(s)}
                  aria-current={s === step ? 'step' : undefined}
                  className={cn(
                    'flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-body',
                    s === step
                      ? 'bg-brand-soft font-semibold text-text'
                      : 'text-muted hover:bg-canvas',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold',
                      progress.done[s]
                        ? 'bg-success text-white'
                        : s === step
                          ? 'bg-brand text-white'
                          : 'bg-canvas text-muted',
                    )}
                  >
                    {progress.done[s] ? (
                      <Check className="size-3.5" aria-label={t('setup.stepDone')} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {t(`setup.${s}.nav`)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 flex-1">
          {step === 'calendar' ? (
            <CalendarStep {...props} />
          ) : step === 'grades' ? (
            <GradesStep {...props} />
          ) : step === 'subjects' ? (
            <SubjectsStep {...props} />
          ) : step === 'tax' ? (
            <TaxStep {...props} />
          ) : (
            <ClassStep {...props} />
          )}
        </div>
      </div>
    </div>
  );
}

type StepProps = { done: boolean; next: () => void; back?: () => void };

/** A step's card and its footer: Back, then Skip for now and the step's own button. */
function StepCard({
  back,
  skip,
  primary,
  error,
  children,
  onSubmit,
}: {
  back?: () => void;
  skip?: () => void;
  primary: ReactNode;
  error?: string | null;
  children: ReactNode;
  onSubmit?: (event: FormEvent) => void;
}) {
  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
      >
        {children}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
          {back ? (
            <Button variant="secondary" onClick={back}>
              {t('setup.back')}
            </Button>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
            {skip ? (
              <Button variant="ghost" onClick={skip}>
                {t('setup.skip')}
              </Button>
            ) : null}
            {primary}
          </div>
        </div>
      </form>
    </Card>
  );
}

/** What a step already has, with where to change it. */
function Already({ children, to, link }: { children: ReactNode; to: string; link: MessageKey }) {
  return (
    <Notice tone="success" title={t('setup.already')}>
      <p>{children}</p>
      <Link to={to} className="mt-1 inline-block font-semibold text-brand hover:underline">
        {t(link)}
      </Link>
    </Notice>
  );
}

/** Saves each item in turn (order matters for grades) and keeps the names that failed. */
async function saveEach<T>(items: T[], save: (item: T) => Promise<unknown>) {
  const failed: { item: T; error: unknown }[] = [];
  for (const item of items) {
    try {
      await save(item);
    } catch (error) {
      failed.push({ item, error });
    }
  }
  return failed;
}

function useRefresh(names: string[]) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      names.map((name) => queryClient.invalidateQueries({ queryKey: [name, membership.org.id] })),
    );
}

// ── Terms ───────────────────────────────────────────────────────────────────

type TermRow = { name: string; startDate: string; endDate: string };

function CalendarStep({ done, next, back }: StepProps) {
  const { membership, org } = useOrg();
  const years = useAcademicYears().data?.data ?? [];
  const terms = useTerms().data?.data ?? [];
  const refresh = useRefresh(['academic-years', 'terms']);
  const thisYear = localNow(org?.timezone ?? 'UTC').date.slice(0, 4);
  const [mode, setMode] = useState<'terms' | 'monthly'>('terms');
  const [name, setName] = useState(thisYear);
  const [start, setStart] = useState(`${thisYear}-01-01`);
  const [end, setEnd] = useState(`${thisYear}-12-31`);
  const [rows, setRows] = useState<TermRow[]>(
    [1, 2, 3, 4].map((n) => ({
      name: t('setup.calendar.termName', { n }),
      startDate: '',
      endDate: '',
    })),
  );
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const year = await api<AcademicYear>('POST', orgApiPath(membership, '/academic-years'), {
        body: { name: name.trim(), startDate: start, endDate: end },
      });
      const filled = rows.filter((r) => r.startDate || r.endDate);
      const failed = await saveEach(filled, (r) =>
        api<Term>('POST', orgApiPath(membership, '/terms'), {
          body: { academicYearId: year.id, name: r.name.trim(), ...dates(r) },
        }),
      );
      return failed;
    },
    onSuccess: async (failed) => {
      await refresh();
      if (failed.length) {
        setProblem(
          t('setup.calendar.someFailed', {
            names: failed.map((f) => f.item.name).join(', '),
            reason: messageOf(failed[0]!.error),
          }),
        );
      } else next();
    },
  });
  const fields = fieldErrors(save.error);

  if (done) {
    return (
      <StepCard back={back} primary={<Button onClick={next}>{t('setup.continue')}</Button>}>
        <Already to={`${orgPath(membership.org.slug)}/settings/terms`} link="setup.calendar.manage">
          {years
            .map((y) =>
              t('setup.calendar.summary', {
                year: y.name,
                n: terms.filter((term) => term.academicYearId === y.id).length,
              }),
            )
            .join(' · ')}
        </Already>
        {problem ? <Notice tone="warning">{problem}</Notice> : null}
      </StepCard>
    );
  }

  return (
    <StepCard
      back={back}
      skip={next}
      error={save.error && !Object.keys(fields).length ? messageOf(save.error) : null}
      onSubmit={() => (mode === 'monthly' ? next() : save.mutate())}
      primary={
        <Button type="submit" loading={save.isPending}>
          {mode === 'monthly' ? t('setup.continue') : t('setup.saveContinue')}
        </Button>
      }
    >
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{t('setup.calendar.how')}</legend>
        <Choice
          name="calendar"
          checked={mode === 'terms'}
          onChange={() => setMode('terms')}
          title={t('setup.calendar.terms')}
          body={t('setup.calendar.termsBody')}
        />
        <Choice
          name="calendar"
          checked={mode === 'monthly'}
          onChange={() => setMode('monthly')}
          title={t('setup.calendar.monthly')}
          body={t('setup.calendar.monthlyBody')}
        />
      </fieldset>

      {mode === 'monthly' ? (
        <Notice tone="info">{t('setup.calendar.monthlyNote')}</Notice>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label={t('setup.calendar.yearName')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fields.name}
            />
            <TextField
              label={t('setup.calendar.yearStart')}
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              error={fields.startDate}
            />
            <TextField
              label={t('setup.calendar.yearEnd')}
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              error={fields.endDate}
            />
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-section font-medium text-text">
                {t('setup.calendar.termsTitle')}
              </h2>
              <p className="mt-1 text-meta text-muted">{t('setup.calendar.termsHelp')}</p>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <TextField
                  label={t('setup.calendar.termNameLabel')}
                  value={row.name}
                  onChange={(e) => setRows(update(rows, i, { name: e.target.value }))}
                />
                <TextField
                  label={t('setup.calendar.termStart', { name: row.name })}
                  type="date"
                  value={row.startDate}
                  onChange={(e) => setRows(update(rows, i, { startDate: e.target.value }))}
                />
                <TextField
                  label={t('setup.calendar.termEnd', { name: row.name })}
                  type="date"
                  value={row.endDate}
                  onChange={(e) => setRows(update(rows, i, { endDate: e.target.value }))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('setup.calendar.removeTerm', { name: row.name })}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  icon={<X className="size-4" />}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              icon={<Plus className="size-4" />}
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    name: t('setup.calendar.termName', { n: rows.length + 1 }),
                    startDate: '',
                    endDate: '',
                  },
                ])
              }
            >
              {t('setup.calendar.addTerm')}
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

const dates = (r: TermRow) => ({ startDate: r.startDate, endDate: r.endDate });
const update = <T,>(list: T[], i: number, change: Partial<T>) =>
  list.map((item, j) => (j === i ? { ...item, ...change } : item));

/** The API's message for a refused save, or the generic one. */
function messageOf(error: unknown) {
  return error instanceof ApiError && error.status === 422 ? error.message : errorMessage(error);
}

// ── Grade levels ────────────────────────────────────────────────────────────

function GradesStep({ done, next, back }: StepProps) {
  const { org } = useOrg();
  const grades = useGradeLevels().data?.data ?? [];
  const coursesPath = useCoursesPath();
  const refresh = useRefresh(['grade-levels']);
  const [preset, setPreset] = useState<GradePreset>(gradePresetFor(org?.country));
  const [names, setNames] = useState<string[]>([...GRADE_PRESETS[preset]]);
  const save = useNamesSave('/grade-levels', refresh, next);

  if (done) {
    return (
      <StepCard back={back} primary={<Button onClick={next}>{t('setup.continue')}</Button>}>
        <Already to={coursesPath('grades')} link="setup.grades.manage">
          {grades.map((g: GradeLevel) => g.name).join(', ')}
        </Already>
      </StepCard>
    );
  }

  return (
    <StepCard
      back={back}
      skip={next}
      error={save.problem}
      onSubmit={() => save.run(names)}
      primary={
        <Button type="submit" loading={save.saving} disabled={!names.length}>
          {t('setup.saveContinue')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-text">{t('setup.grades.startFrom')}</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(GRADE_PRESETS) as GradePreset[]).map((key) => (
            <Chip
              key={key}
              pressed={preset === key}
              onClick={() => {
                setPreset(key);
                setNames([...GRADE_PRESETS[key]]);
              }}
            >
              {t(`setup.grades.preset.${key}`)}
            </Chip>
          ))}
        </div>
      </div>
      <NameList
        label={t('setup.grades.list')}
        addLabel={t('setup.grades.add')}
        names={names}
        onChange={setNames}
      />
    </StepCard>
  );
}

/** Saves names one by one at a list path (grades, subjects), then moves on or says what failed. */
function useNamesSave(path: string, refresh: () => Promise<unknown>, next: () => void) {
  const { membership } = useOrg();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (names: string[]) =>
      saveEach(names, (name) => api('POST', orgApiPath(membership, path), { body: { name } })),
    onSuccess: async (failed) => {
      await refresh();
      if (failed.length) {
        setProblem(
          t('setup.someFailed', {
            names: failed.map((f) => f.item).join(', '),
            reason: messageOf(failed[0]!.error),
          }),
        );
      } else next();
    },
  });
  return {
    run: (names: string[]) => {
      setProblem(null);
      save.mutate(names);
    },
    saving: save.isPending,
    problem: problem ?? (save.error ? messageOf(save.error) : null),
  };
}

/** Names as removable chips, with a field to add one more. */
function NameList({
  label,
  addLabel,
  names,
  onChange,
}: {
  label: string;
  addLabel: string;
  names: string[];
  onChange: (names: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const name = draft.trim();
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      onChange([...names, name]);
    }
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-label font-medium text-text">{label}</p>
      {names.length ? (
        <ul className="flex flex-wrap gap-2">
          {names.map((name) => (
            <li
              key={name}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border-strong bg-surface pr-1 pl-3 text-body text-text"
            >
              {name}
              <button
                type="button"
                aria-label={t('setup.remove', { name })}
                onClick={() => onChange(names.filter((n) => n !== name))}
                className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-canvas"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted">{t('setup.none')}</p>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label={addLabel}
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={add}>
          {t('setup.addButton')}
        </Button>
      </div>
    </div>
  );
}

// ── Subjects ────────────────────────────────────────────────────────────────

function SubjectsStep({ done, next, back }: StepProps) {
  const subjects = useSubjects().data?.data ?? [];
  const coursesPath = useCoursesPath();
  const refresh = useRefresh(['subjects']);
  const [names, setNames] = useState<string[]>(STARTING_SUBJECTS);
  const save = useNamesSave('/subjects', refresh, next);
  const toggle = (name: string) =>
    setNames(names.includes(name) ? names.filter((n) => n !== name) : [...names, name]);

  if (done) {
    return (
      <StepCard back={back} primary={<Button onClick={next}>{t('setup.continue')}</Button>}>
        <Already to={coursesPath('subjects')} link="setup.subjects.manage">
          {subjects.map((s: Subject) => s.name).join(', ')}
        </Already>
      </StepCard>
    );
  }

  return (
    <StepCard
      back={back}
      skip={next}
      error={save.problem}
      onSubmit={() => save.run(names)}
      primary={
        <Button type="submit" loading={save.saving} disabled={!names.length}>
          {t('setup.saveContinue')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-text">{t('setup.subjects.suggested')}</p>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((name) => (
            <Chip key={name} pressed={names.includes(name)} onClick={() => toggle(name)}>
              {name}
            </Chip>
          ))}
        </div>
      </div>
      <NameList
        label={t('setup.subjects.list')}
        addLabel={t('setup.subjects.add')}
        names={names}
        onChange={setNames}
      />
    </StepCard>
  );
}

// ── Tax ─────────────────────────────────────────────────────────────────────

function TaxStep({ done, next, back }: StepProps) {
  const { membership, org } = useOrg();
  const queryClient = useQueryClient();
  const rates = useTaxRates().data ?? [];
  const refresh = useRefresh(['tax-rates']);
  const [charges, setCharges] = useState(false);
  const [name, setName] = useState(taxNameFor(org?.country));
  const [rate, setRate] = useState('');
  const [inclusive, setInclusive] = useState(true);
  const [taxNumber, setTaxNumber] = useState(org?.taxNumber ?? '');
  const [rateError, setRateError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: async (rateBps: number) => {
      await api<TaxRate>('POST', orgApiPath(membership, '/tax-rates'), {
        body: { name: name.trim(), rateBps, inclusive, isDefault: true },
      });
      const number = taxNumber.trim();
      if (org && number !== (org.taxNumber ?? '')) {
        const updated = await api<Org>('PATCH', orgApiPath(membership), {
          body: { updatedAt: org.updatedAt, taxNumber: number || null },
        });
        queryClient.setQueryData(['org', membership.org.id], updated);
      }
    },
    onSuccess: async () => {
      await refresh();
      next();
    },
  });
  const fields = fieldErrors(save.error);

  if (done) {
    return (
      <StepCard back={back} primary={<Button onClick={next}>{t('setup.continue')}</Button>}>
        <Already
          to={`${orgPath(membership.org.slug)}/settings/pricing?tab=tax`}
          link="setup.tax.manage"
        >
          {rates.map((r) => `${r.name} ${percentLabel(r.rateBps)}`).join(', ')}
        </Already>
      </StepCard>
    );
  }

  function submit() {
    if (!charges) return next();
    const bps = parsePercent(rate);
    setRateError(bps === null ? t('setup.tax.rateInvalid') : undefined);
    if (bps !== null) save.mutate(bps);
  }

  return (
    <StepCard
      back={back}
      skip={next}
      error={save.error && !Object.keys(fields).length ? messageOf(save.error) : null}
      onSubmit={submit}
      primary={
        <Button type="submit" loading={save.isPending}>
          {charges ? t('setup.saveContinue') : t('setup.continue')}
        </Button>
      }
    >
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{t('setup.tax.question')}</legend>
        <Choice
          name="tax"
          checked={!charges}
          onChange={() => setCharges(false)}
          title={t('setup.tax.no')}
          body={t('setup.tax.noBody')}
        />
        <Choice
          name="tax"
          checked={charges}
          onChange={() => setCharges(true)}
          title={t('setup.tax.yes')}
          body={t('setup.tax.yesBody')}
        />
      </fieldset>
      {charges ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('setup.tax.name')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fields.name}
            />
            <TextField
              label={t('setup.tax.rate')}
              required
              inputMode="decimal"
              placeholder="15"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              error={rateError ?? fields.rateBps}
              helper={t('setup.tax.rateHelper')}
            />
          </div>
          <div>
            <Toggle
              checked={inclusive}
              onChange={setInclusive}
              label={t('setup.tax.inclusive')}
              hint={t('setup.tax.inclusiveHint')}
            />
          </div>
          <TextField
            label={t('setup.tax.number')}
            value={taxNumber}
            maxLength={40}
            onChange={(e) => setTaxNumber(e.target.value)}
            helper={t('setup.tax.numberHelper')}
            error={fields.taxNumber}
          />
        </>
      ) : null}
    </StepCard>
  );
}

// ── First class ─────────────────────────────────────────────────────────────

function ClassStep({ done, next, back }: StepProps) {
  const { membership } = useOrg();
  const courses = useCourses().data?.data ?? [];
  const classes = useAllClasses().data?.data ?? [];
  const [open, setOpen] = useState(false);

  return (
    <StepCard
      back={back}
      primary={
        done ? (
          <Button onClick={next}>{t('setup.finish')}</Button>
        ) : (
          <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            {t('setup.class.add')}
          </Button>
        )
      }
      skip={done ? undefined : next}
    >
      {done ? (
        <Already to={`${orgPath(membership.org.slug)}/classes`} link="setup.class.manage">
          {t(classes.length === 1 ? 'setup.class.summary.one' : 'setup.class.summary', {
            n: classes.length,
          })}
        </Already>
      ) : (
        <p className="text-body text-muted">
          {courses.length ? t('setup.class.withCourses') : t('setup.class.noCourses')}
        </p>
      )}
      <ClassDialog open={open} onClose={() => setOpen(false)} />
    </StepCard>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

/** A choice card: one of two ways a step can go. */
function Choice({
  name,
  checked,
  onChange,
  title,
  body,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand',
        checked ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface hover:bg-canvas',
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      <span className="text-body font-semibold text-text">{title}</span>
      <span className="text-meta text-muted">{body}</span>
    </label>
  );
}

/** A toggle chip for a suggestion. */
function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body transition-colors duration-150',
        pressed
          ? 'border-brand bg-brand-soft font-semibold text-text'
          : 'border-border-strong bg-surface text-secondary-text hover:bg-canvas',
      )}
    >
      {pressed ? <Check className="size-3.5 text-brand" aria-hidden /> : null}
      {children}
    </button>
  );
}
