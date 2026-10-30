import type {
  AcademicYear,
  Branch,
  CreateInvitation,
  Org,
  Room,
  StaffMember,
  TaxRate,
  Term,
  UpdateOrg,
} from '@edustrux/shared';
import { localNow } from '@edustrux/shared/dates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  Layers,
  Plus,
  UsersRound,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageError, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { t, type MessageKey } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { useAllClasses, useCoursesPath, useSubjects, useTerms } from '../../lib/classes';
import { orgApiPath, useOrg } from '../../lib/org';
import { useAcademicYears, useBranches, useGradeLevels, type Page } from '../../lib/people';
import { parsePercent, percentLabel, useTaxRates } from '../../lib/pricing';
import { localeFor } from '../../lib/regions';
import { can, invitableRoles, roleLabel } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { DetailsFields, draftOf, TypeFields, type CentreDraft } from './CentreSteps';
import {
  GRADE_PRESETS,
  gradePresetFor,
  STARTING_SUBJECTS,
  SUBJECTS,
  taxNameFor,
  type GradePreset,
} from './presets';
import {
  Chip,
  ChoiceCard,
  SETUP_STEPS,
  SetupLayout,
  StepFrame,
  StepIcon,
  type SetupStep,
  type StepState,
} from './SetupLayout';

/**
 * The setup wizard inside a centre (TUI-130, from the owner's Figma Make design): eight steps on
 * a full screen of their own, opened after `POST /orgs` and from Home. The first two change the
 * org; the rest add its tax rate, rooms, calendar, grade levels, subjects and staff, each with
 * the settings screens' own calls. A step counts as done once its data exists, so the wizard
 * keeps no state of its own.
 */
export function SetupPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'org:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <SetupWizard />;
}

/** Which steps already have their data: what Home's checklist shows too. */
export function useSetupProgress() {
  const { membership, org } = useOrg();
  const taxRates = useTaxRates();
  const branches = useBranches();
  const firstBranch = branches.data?.data[0]?.id;
  const rooms = useBranchRooms(firstBranch);
  const years = useAcademicYears();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const staff = useQuery({
    // Not ['staff', orgId] alone: Settings › Team keeps its pages there.
    queryKey: ['staff', membership.org.id, { first: 2 }],
    queryFn: ({ signal }) =>
      api<Page<StaffMember>>('GET', orgApiPath(membership, '/staff?limit=2'), { signal }),
    staleTime: 60_000,
  });
  const classes = useAllClasses();
  const queries = [taxRates, branches, years, grades, subjects, staff, classes];
  const done = {
    details: true,
    type: true,
    tax: Boolean(taxRates.data?.length),
    branch: Boolean(rooms.data?.data.length),
    calendar: Boolean(years.data?.data.length),
    grades: Boolean(grades.data?.data.length),
    subjects: Boolean(subjects.data?.data.length),
    team: (staff.data?.data.length ?? 0) > 1,
    class: Boolean(classes.data?.data.length),
  };
  return {
    loading: queries.some((q) => q.isPending) || (firstBranch !== undefined && rooms.isPending),
    error: queries.find((q) => q.error)?.error,
    done,
    // Finish setup marks it complete (D-195): a step answered with nothing to save (monthly
    // billing, no staff yet) doesn't keep the checklist open after that.
    complete: Boolean(org?.setupCompletedAt),
    // Where "Continue setup" goes: the first wizard step still without its data. Tax isn't
    // counted, since no tax is an answer too.
    nextStep: (['branch', 'calendar', 'grades', 'subjects', 'team'] as const).find(
      (key) => !done[key],
    ),
  };
}

function useBranchRooms(branchId: string | undefined) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['rooms', membership.org.id, branchId],
    queryFn: ({ signal }) =>
      api<Page<Room>>('GET', orgApiPath(membership, `/branches/${branchId}/rooms?limit=200`), {
        signal,
      }),
    enabled: Boolean(branchId),
    staleTime: 60_000,
  });
}

function SetupWizard() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const progress = useSetupProgress();
  const navigate = useNavigate();
  const asked = params.get('step') as SetupStep;
  const step: SetupStep = SETUP_STEPS.includes(asked) ? asked : 'details';
  const index = SETUP_STEPS.indexOf(step);
  const home = orgPath(membership.org.slug);

  const go = (to: SetupStep) => setParams({ step: to });
  const next = () =>
    index + 1 < SETUP_STEPS.length ? go(SETUP_STEPS[index + 1]!) : navigate(home);
  const back = index > 0 ? () => go(SETUP_STEPS[index - 1]!) : undefined;

  if (progress.error) return <PageError error={progress.error} />;
  if (progress.loading) return <PageLoading />;

  const states = Object.fromEntries(
    SETUP_STEPS.map((s) => [s, s === step ? 'current' : progress.done[s] ? 'done' : 'todo']),
  ) as Record<SetupStep, StepState>;
  const props: StepProps = { done: progress.done[step], next, back };

  return (
    <SetupLayout step={step} states={states} onPick={go}>
      {step === 'details' ? (
        <DetailsStep {...props} />
      ) : step === 'type' ? (
        <TypeStep {...props} />
      ) : step === 'tax' ? (
        <TaxStep {...props} />
      ) : step === 'branch' ? (
        <BranchStep {...props} />
      ) : step === 'calendar' ? (
        <CalendarStep {...props} />
      ) : step === 'grades' ? (
        <GradesStep {...props} />
      ) : step === 'subjects' ? (
        <SubjectsStep {...props} />
      ) : (
        <TeamStep {...props} home={home} />
      )}
    </SetupLayout>
  );
}

type StepProps = { done: boolean; next: () => void; back?: () => void };

const ContinueButton = ({ loading, label }: { loading?: boolean; label?: MessageKey }) => (
  <Button type="submit" loading={loading}>
    {t(label ?? 'setup.continue')}
    <ArrowRight className="size-4" aria-hidden />
  </Button>
);

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

/** Saves each item in turn (order matters for grades) and keeps those that failed. */
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

/** The API's message for a refused save, or the generic one. */
function messageOf(error: unknown) {
  return error instanceof ApiError && (error.status === 422 || error.status === 409)
    ? error.message
    : errorMessage(error);
}

type OrgChanges = Omit<UpdateOrg, 'updatedAt'>;

/** Saves a change to the org and keeps the cached org up to date. */
function useSaveOrg(onSaved: () => void) {
  const { membership, org } = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: OrgChanges) =>
      api<Org>('PATCH', orgApiPath(membership), {
        body: { updatedAt: org!.updatedAt, ...changes },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', membership.org.id], updated);
      onSaved();
    },
  });
}

// ── Centre details and setup type ───────────────────────────────────────────

function DetailsStep({ next, back }: StepProps) {
  const { org } = useOrg();
  const [draft, setDraft] = useState<CentreDraft>(() => draftOf(org!));
  const save = useSaveOrg(next);
  const saved = draftOf(org!);
  const changes: OrgChanges = {};
  if (draft.name.trim() !== saved.name) changes.name = draft.name.trim();
  if (draft.country !== saved.country) {
    changes.country = draft.country || null;
    changes.locale = localeFor(draft.country);
  }
  if (draft.timezone !== saved.timezone) changes.timezone = draft.timezone;
  if (draft.dateFormat !== saved.dateFormat) changes.dateFormat = draft.dateFormat;
  const fields = fieldErrors(save.error);

  return (
    <StepFrame
      step="details"
      back={back}
      error={save.error && !Object.keys(fields).length ? messageOf(save.error) : null}
      onSubmit={() => (Object.keys(changes).length ? save.mutate(changes) : next())}
      primary={<ContinueButton loading={save.isPending} />}
    >
      <DetailsFields
        draft={draft}
        onChange={(change) => setDraft((d) => ({ ...d, ...change }))}
        creating={false}
        errors={fields}
      />
    </StepFrame>
  );
}

function TypeStep({ next, back }: StepProps) {
  const { org } = useOrg();
  const [solo, setSolo] = useState(org!.singleTutorMode);
  const save = useSaveOrg(next);
  const fields = fieldErrors(save.error);
  return (
    <StepFrame
      step="type"
      back={back}
      error={save.error && !fields.singleTutorMode ? messageOf(save.error) : null}
      onSubmit={() =>
        solo !== org!.singleTutorMode ? save.mutate({ singleTutorMode: solo }) : next()
      }
      primary={<ContinueButton loading={save.isPending} />}
    >
      <TypeFields
        solo={solo}
        onChange={setSolo}
        error={fields.singleTutorMode ? messageOf(save.error) : undefined}
      />
    </StepFrame>
  );
}

// ── Tax ─────────────────────────────────────────────────────────────────────

function TaxStep({ done, next, back }: StepProps) {
  const { membership, org } = useOrg();
  const queryClient = useQueryClient();
  const rates = useTaxRates().data ?? [];
  const refresh = useRefresh(['tax-rates']);
  const [charges, setCharges] = useState(true);
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
      <StepFrame step="tax" back={back} onSubmit={next} primary={<ContinueButton />}>
        <Already
          to={`${orgPath(membership.org.slug)}/settings/pricing?tab=tax`}
          link="setup.tax.manage"
        >
          {rates.map((r) => `${r.name} ${percentLabel(r.rateBps)}`).join(', ')}
        </Already>
      </StepFrame>
    );
  }

  function submit() {
    if (!charges) return next();
    const bps = parsePercent(rate);
    setRateError(bps === null ? t('setup.tax.rateInvalid') : undefined);
    if (bps !== null) save.mutate(bps);
  }

  return (
    <StepFrame
      step="tax"
      back={back}
      error={save.error && !Object.keys(fields).length ? messageOf(save.error) : null}
      onSubmit={submit}
      primary={<ContinueButton loading={save.isPending} />}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t('setup.tax.question')}</legend>
        <ChoiceCard
          name="tax"
          checked={!charges}
          onChange={() => setCharges(false)}
          title={t('setup.tax.no')}
          body={t('setup.tax.noBody')}
        />
        <ChoiceCard
          name="tax"
          checked={charges}
          onChange={() => setCharges(true)}
          title={t('setup.tax.yes')}
          body={t('setup.tax.yesBody')}
        />
      </fieldset>
      {charges ? (
        <div className="grid gap-4 rounded-xl border border-border bg-canvas p-4 sm:grid-cols-2">
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
            placeholder="15%"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            error={rateError ?? fields.rateBps}
          />
          <TextField
            label={t('setup.tax.number')}
            maxLength={40}
            placeholder={t('setup.tax.numberPlaceholder')}
            value={taxNumber}
            onChange={(e) => setTaxNumber(e.target.value)}
            error={fields.taxNumber}
          />
          <SelectField
            label={t('setup.tax.pricesAre')}
            value={inclusive ? 'inclusive' : 'exclusive'}
            onChange={(e) => setInclusive(e.target.value === 'inclusive')}
            options={[
              { value: 'inclusive', label: t('setup.tax.inclusive') },
              { value: 'exclusive', label: t('setup.tax.exclusive') },
            ]}
          />
        </div>
      ) : null}
    </StepFrame>
  );
}

// ── Branch and rooms ────────────────────────────────────────────────────────

type NewRoom = { name: string; capacity: string };

function BranchStep({ next, back }: StepProps) {
  const { membership } = useOrg();
  const branch = useBranches().data?.data[0];
  const rooms = useBranchRooms(branch?.id).data?.data ?? [];
  const refresh = useRefresh(['branches', 'rooms']);
  const [name, setName] = useState(branch?.name ?? '');
  const [added, setAdded] = useState<NewRoom[]>(
    rooms.length ? [] : [{ name: t('setup.branch.roomName', { n: 1 }), capacity: '' }],
  );
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (branch && name.trim() && name.trim() !== branch.name) {
        await api<Branch>('PATCH', orgApiPath(membership, `/branches/${branch.id}`), {
          body: { updatedAt: branch.updatedAt, name: name.trim() },
        });
      }
      const filled = added.filter((r) => r.name.trim());
      return saveEach(filled, (r) =>
        api<Room>('POST', orgApiPath(membership, `/branches/${branch!.id}/rooms`), {
          body: {
            name: r.name.trim(),
            ...(r.capacity.trim() ? { capacity: Number(r.capacity) } : {}),
          },
        }),
      );
    },
    onSuccess: async (failed) => {
      await refresh();
      if (failed.length) {
        setAdded(failed.map((f) => f.item));
        setProblem(
          t('setup.someFailed', {
            names: failed.map((f) => f.item.name).join(', '),
            reason: messageOf(failed[0]!.error),
          }),
        );
      } else next();
    },
  });

  return (
    <StepFrame
      step="branch"
      back={back}
      skip={next}
      error={problem ?? (save.error ? messageOf(save.error) : null)}
      onSubmit={() => {
        setProblem(null);
        save.mutate();
      }}
      primary={<ContinueButton loading={save.isPending} />}
    >
      <StepIcon>
        <Building2 />
      </StepIcon>
      <TextField
        label={t('setup.branch.name')}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        helper={t('setup.branch.nameHelper')}
      />
      <div className="flex flex-col gap-3">
        <p className="text-label font-medium text-text">{t('setup.branch.rooms')}</p>
        {rooms.length ? (
          <ul className="flex flex-wrap gap-2">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="inline-flex h-10 items-center rounded-lg border border-brand bg-brand-soft/60 px-3.5 text-body font-semibold text-brand"
              >
                {room.capacity ? `${room.name} · ${room.capacity}` : room.name}
              </li>
            ))}
          </ul>
        ) : null}
        {added.map((room, i) => (
          <div key={i} className="grid grid-cols-[1fr_96px_auto] items-end gap-2">
            <TextField
              label={t('setup.branch.roomLabel')}
              value={room.name}
              onChange={(e) => setAdded(update(added, i, { name: e.target.value }))}
            />
            <TextField
              label={t('setup.branch.seats')}
              inputMode="numeric"
              value={room.capacity}
              onChange={(e) =>
                setAdded(update(added, i, { capacity: e.target.value.replace(/\D/g, '') }))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('setup.remove', { name: room.name })}
              onClick={() => setAdded(added.filter((_, j) => j !== i))}
              icon={<X className="size-4" />}
            />
          </div>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          icon={<Plus className="size-4" />}
          onClick={() =>
            setAdded([
              ...added,
              {
                name: t('setup.branch.roomName', { n: rooms.length + added.length + 1 }),
                capacity: '',
              },
            ])
          }
        >
          {t('setup.branch.addRoom')}
        </Button>
      </div>
    </StepFrame>
  );
}

const update = <T,>(list: T[], i: number, change: Partial<T>) =>
  list.map((item, j) => (j === i ? { ...item, ...change } : item));

// ── Academic year ───────────────────────────────────────────────────────────

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
      return saveEach(filled, (r) =>
        api<Term>('POST', orgApiPath(membership, '/terms'), {
          body: {
            academicYearId: year.id,
            name: r.name.trim(),
            startDate: r.startDate,
            endDate: r.endDate,
          },
        }),
      );
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
      <StepFrame step="calendar" back={back} onSubmit={next} primary={<ContinueButton />}>
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
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step="calendar"
      back={back}
      skip={next}
      error={save.error && !Object.keys(fields).length ? messageOf(save.error) : null}
      onSubmit={() => (mode === 'monthly' ? next() : save.mutate())}
      primary={<ContinueButton loading={save.isPending} />}
    >
      <StepIcon>
        <CalendarDays />
      </StepIcon>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('setup.calendar.how')}</legend>
        <ChoiceCard
          name="calendar"
          checked={mode === 'terms'}
          onChange={() => setMode('terms')}
          title={t('setup.calendar.terms')}
          body={t('setup.calendar.termsBody')}
        />
        <ChoiceCard
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
              <h3 className="text-section font-medium text-text">
                {t('setup.calendar.termsTitle')}
              </h3>
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
    </StepFrame>
  );
}

// ── Grade levels and subjects ───────────────────────────────────────────────

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

function GradesStep({ done, next, back }: StepProps) {
  const { org } = useOrg();
  const grades = useGradeLevels().data?.data ?? [];
  const coursesPath = useCoursesPath();
  const refresh = useRefresh(['grade-levels']);
  const [preset, setPreset] = useState<GradePreset | 'custom'>(gradePresetFor(org?.country));
  const [names, setNames] = useState<string[]>(() => [
    ...GRADE_PRESETS[gradePresetFor(org?.country)],
  ]);
  const save = useNamesSave('/grade-levels', refresh, next);

  if (done) {
    return (
      <StepFrame step="grades" back={back} onSubmit={next} primary={<ContinueButton />}>
        <Already to={coursesPath('grades')} link="setup.grades.manage">
          {grades.map((g) => g.name).join(', ')}
        </Already>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step="grades"
      back={back}
      skip={next}
      error={save.problem}
      onSubmit={() => (names.length ? save.run(names) : next())}
      primary={<ContinueButton loading={save.saving} />}
    >
      <StepIcon>
        <Layers />
      </StepIcon>
      <div className="flex flex-wrap justify-center gap-2">
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
        <Chip
          pressed={preset === 'custom'}
          onClick={() => {
            setPreset('custom');
            setNames([]);
          }}
        >
          {t('setup.grades.custom')}
        </Chip>
      </div>
      <NameList
        label={t('setup.grades.list')}
        addLabel={t('setup.grades.add')}
        names={names}
        onChange={setNames}
      />
    </StepFrame>
  );
}

function SubjectsStep({ done, next, back }: StepProps) {
  const subjects = useSubjects().data?.data ?? [];
  const coursesPath = useCoursesPath();
  const refresh = useRefresh(['subjects']);
  const [names, setNames] = useState<string[]>(STARTING_SUBJECTS);
  const save = useNamesSave('/subjects', refresh, next);
  const toggle = (name: string) =>
    setNames(names.includes(name) ? names.filter((n) => n !== name) : [...names, name]);
  const own = names.filter((n) => !SUBJECTS.includes(n));

  if (done) {
    return (
      <StepFrame step="subjects" back={back} onSubmit={next} primary={<ContinueButton />}>
        <Already to={coursesPath('subjects')} link="setup.subjects.manage">
          {subjects.map((s) => s.name).join(', ')}
        </Already>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step="subjects"
      back={back}
      skip={next}
      error={save.problem}
      onSubmit={() => (names.length ? save.run(names) : next())}
      primary={<ContinueButton loading={save.saving} />}
    >
      <StepIcon>
        <BookOpen />
      </StepIcon>
      <div className="flex flex-wrap justify-center gap-2">
        {[...SUBJECTS, ...own].map((name) => (
          <Chip key={name} pressed={names.includes(name)} onClick={() => toggle(name)}>
            {name}
          </Chip>
        ))}
      </div>
      <AddName
        label={t('setup.subjects.add')}
        onAdd={(name) => {
          if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) {
            setNames([...names, name]);
          }
        }}
      />
    </StepFrame>
  );
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
  return (
    <div className="flex flex-col gap-3">
      <p className="text-label font-medium text-text">{label}</p>
      {names.length ? (
        <ul className="flex flex-wrap gap-2">
          {names.map((name) => (
            <li
              key={name}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border-strong bg-surface pr-1 pl-3 text-body text-text"
            >
              {name}
              <button
                type="button"
                aria-label={t('setup.remove', { name })}
                onClick={() => onChange(names.filter((n) => n !== name))}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-canvas"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted">{t('setup.none')}</p>
      )}
      <AddName
        label={addLabel}
        onAdd={(name) => {
          if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) {
            onChange([...names, name]);
          }
        }}
      />
    </div>
  );
}

/** A field and an Add button; Enter adds too. */
function AddName({ label, onAdd }: { label: string; onAdd: (name: string) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft('');
  };
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <TextField
          label={label}
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
  );
}

// ── Invite staff ────────────────────────────────────────────────────────────

type Invite = { email: string; role: CreateInvitation['role'] };

function TeamStep({ done, back, home }: StepProps & { home: string }) {
  const { membership, org } = useOrg();
  const navigate = useNavigate();
  const refresh = useRefresh(['staff']);
  const roles = invitableRoles(membership.role).filter(
    (r): r is Invite['role'] => r !== 'owner' && r !== 'parent',
  );
  const [invites, setInvites] = useState<Invite[]>([{ email: '', role: 'teacher' }]);
  const [problem, setProblem] = useState<string | null>(null);
  // Finishing marks the setup complete, so Home stops offering it (D-195).
  const complete = useSaveOrg(() => navigate(home));
  const finish = () =>
    org?.setupCompletedAt ? navigate(home) : complete.mutate({ setupCompleted: true });

  const save = useMutation({
    mutationFn: (list: Invite[]) =>
      saveEach(list, (invite) =>
        api('POST', orgApiPath(membership, '/staff/invitations'), {
          body: { email: invite.email.trim(), role: invite.role } satisfies CreateInvitation,
        }),
      ),
    onSuccess: async (failed) => {
      await refresh();
      if (failed.length) {
        setInvites(failed.map((f) => f.item));
        setProblem(
          t('setup.someFailed', {
            names: failed.map((f) => f.item.email).join(', '),
            reason: messageOf(failed[0]!.error),
          }),
        );
      } else finish();
    },
  });
  const filled = invites.filter((i) => i.email.trim());

  return (
    <StepFrame
      step="team"
      back={back}
      skip={done ? undefined : finish}
      error={
        problem ??
        (save.error ? messageOf(save.error) : complete.error ? messageOf(complete.error) : null)
      }
      onSubmit={() => {
        setProblem(null);
        if (filled.length) save.mutate(filled);
        else finish();
      }}
      primary={
        <ContinueButton loading={save.isPending || complete.isPending} label="setup.finishSetup" />
      }
    >
      <StepIcon>
        <UsersRound />
      </StepIcon>
      {invites.map((invite, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_180px_auto]">
          <TextField
            label={t('setup.team.email')}
            type="email"
            autoComplete="off"
            placeholder="teacher@example.com"
            value={invite.email}
            onChange={(e) => setInvites(update(invites, i, { email: e.target.value }))}
          />
          <SelectField
            label={t('setup.team.role')}
            value={invite.role}
            onChange={(e) =>
              setInvites(update(invites, i, { role: e.target.value as Invite['role'] }))
            }
            options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('setup.remove', { name: invite.email || t('setup.team.email') })}
            onClick={() => setInvites(invites.filter((_, j) => j !== i))}
            icon={<X className="size-4" />}
          />
        </div>
      ))}
      <Button
        variant="secondary"
        className="self-start"
        icon={<Plus className="size-4" />}
        onClick={() => setInvites([...invites, { email: '', role: 'teacher' }])}
      >
        {t('setup.team.another')}
      </Button>
      <p className="text-meta text-muted">{t('setup.team.note')}</p>
    </StepFrame>
  );
}
