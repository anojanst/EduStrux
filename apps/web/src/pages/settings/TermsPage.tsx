import type { AcademicYear, Class, Holiday, Session, Term } from '@edustrux/shared';
import { addDays, diffDays, localNow } from '@edustrux/shared/dates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarRange, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageError, PageHeader } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t, type MessageKey } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { currentTerm, useAllClasses, useClassPaths, useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, useAcademicYears, useBranches, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { RunInvoicesDialog } from '../billing/RunInvoicesDialog';
import { SkeletonRows } from '../people/parts';
import { StaleOrError } from '../people/dialogs';

/**
 * Settings › Terms & holidays (TUI-127): the academic years, the terms in each, and the days the
 * centre is closed. The owner changes them; other staff see them. Parents use the portal instead.
 */
export function TermsPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'org:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <TermsAndHolidays />;
}

type Range = { startDate: string; endDate: string };

type Open =
  | { kind: 'year'; year?: AcademicYear }
  | { kind: 'term'; year: AcademicYear; term?: Term }
  | { kind: 'deleteTerm'; term: Term }
  | { kind: 'holiday' }
  | { kind: 'deleteHoliday'; holiday: Holiday }
  | { kind: 'invoices'; term: Term }
  | null;

const byStart = (a: Range, b: Range) => a.startDate.localeCompare(b.startDate);
const overlaps = (a: Range, b: Range) => a.startDate <= b.endDate && a.endDate >= b.startDate;
const daysIn = (r: Range) => diffDays(r.startDate, r.endDate) + 1;
/** Whole weeks a term runs, at least one: 27 Jan – 11 Apr is 11. */
const weeksIn = (r: Range) => Math.max(1, Math.round(daysIn(r) / 7));
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const count = (n: number, one: MessageKey, many: MessageKey) => t(n === 1 ? one : many, { n });

/** The org's holidays, under the key the timetable and portal read them by. */
function useHolidays() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['holidays', membership.org.id],
    queryFn: ({ signal }) =>
      api<Page<Holiday>>('GET', orgApiPath(membership, '/holidays?limit=200'), { signal }),
    staleTime: 60_000,
  });
}

/** After a change to the calendar: the lists that show it, and the lessons a holiday removed. */
function useRefreshCalendar() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['academic-years', 'terms', 'holidays', 'sessions'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, membership.org.id] }),
      ),
    );
}

/** "27 Jan – 11 Apr", or "Mon 1 Jun" for one day (`withDay` names the weekday, as holidays do). */
function useRange() {
  const format = useFormat();
  return (r: Range, withDay = false) => {
    const end = withDay ? format.day : format.dayShort;
    if (r.startDate === r.endDate) return end(r.startDate);
    return `${end(r.startDate)} – ${end(r.endDate)}`;
  };
}

function TermsAndHolidays() {
  const { membership } = useOrg();
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Open>(null);
  const owner = can(membership.role, 'org:write');
  const years = useAcademicYears();
  const terms = useTerms();
  const holidays = useHolidays();
  const classes = useAllClasses();
  const today = format.today;

  const yearList = [...(years.data?.data ?? [])].sort(byStart);
  const year =
    yearList.find((y) => y.id === params.get('year')) ?? currentTerm(yearList, today) ?? null;
  const yearTerms = (terms.data?.data ?? [])
    .filter((term) => term.academicYearId === year?.id)
    .sort(byStart);
  // A break can span the end of a year, so a year shows every holiday that touches it.
  const yearHolidays = (holidays.data?.data ?? [])
    .filter((h) => !year || overlaps(h, year))
    .sort(byStart);
  const allClasses = classes.data?.data ?? [];
  const close = () => setOpen(null);

  const failed = [years, terms, holidays].find((q) => q.isError);
  if (failed) {
    return (
      <PageError
        error={failed.error}
        onRetry={() => [years, terms, holidays].forEach((q) => void q.refetch())}
      />
    );
  }
  const loading = years.isPending || terms.isPending || holidays.isPending;
  const index = year ? yearList.indexOf(year) : -1;
  const pick = (next: AcademicYear | undefined) => {
    if (!next) return;
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('year', next.id);
        return out;
      },
      { replace: true },
    );
  };

  const switcher = yearList.length ? (
    <div className="grid grid-cols-[44px_1fr_44px] sm:flex sm:items-center">
      <button
        type="button"
        aria-label={t('terms.year.previous')}
        disabled={index <= 0}
        onClick={() => pick(yearList[index - 1])}
        className="grid h-11 place-items-center rounded-l-lg border border-border-strong bg-surface hover:bg-canvas disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-surface sm:size-10"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <select
        aria-label={t('terms.year.label')}
        value={year?.id}
        onChange={(e) => pick(yearList.find((y) => y.id === e.target.value))}
        className="h-11 min-w-0 border-y border-border-strong bg-surface px-3 text-label text-text focus:outline-2 focus:outline-brand sm:h-10"
      >
        {yearList.map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={t('terms.year.next')}
        disabled={index >= yearList.length - 1}
        onClick={() => pick(yearList[index + 1])}
        className="grid h-11 place-items-center rounded-r-lg border border-border-strong bg-surface hover:bg-canvas disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-surface sm:size-10"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
      {owner && year ? (
        <Button
          className="col-span-3 mt-2.5 sm:mt-0 sm:ml-2.5"
          icon={<Plus className="size-4" />}
          onClick={() => setOpen({ kind: 'term', year })}
        >
          {t('terms.add')}
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="max-w-[1050px]">
      <PageHeader
        overline={t('courses.overline')}
        title={t('terms.title')}
        subtitle={
          !loading && year
            ? [
                year.name,
                count(yearTerms.length, 'terms.count.one', 'terms.count'),
                count(yearHolidays.length, 'terms.holidays.count.one', 'terms.holidays.count'),
              ].join(' · ')
            : undefined
        }
        action={switcher}
      />
      {!owner ? (
        <Notice tone="info" className="mb-4">
          {t('terms.readOnly')}
        </Notice>
      ) : null}
      <p className="mb-5 max-w-[720px] text-body text-muted">{t('terms.explainer')}</p>

      {loading ? (
        <Card flush>
          <SkeletonRows rows={4} />
        </Card>
      ) : (
        <>
          {year ? (
            <YearCard
              year={year}
              terms={yearTerms}
              holidays={yearHolidays}
              owner={owner}
              onOpen={setOpen}
            />
          ) : (
            <Card className="flex flex-col items-center gap-2 py-10 text-center">
              <CalendarRange className="size-5 text-brand" aria-hidden />
              <b className="text-body font-semibold text-text">{t('terms.year.none')}</b>
              <p className="max-w-[420px] text-body text-muted">{t('terms.year.noneBody')}</p>
              {owner ? (
                <Button
                  className="mt-2"
                  icon={<Plus className="size-4" />}
                  onClick={() => setOpen({ kind: 'year' })}
                >
                  {t('terms.year.add')}
                </Button>
              ) : null}
            </Card>
          )}
          {year ? (
            <TermsCard
              year={year}
              terms={yearTerms}
              classes={allClasses}
              classesLoaded={classes.isSuccess}
              owner={owner}
              onOpen={setOpen}
            />
          ) : null}
          <HolidaysCard
            holidays={yearHolidays}
            byMonthOnly={Boolean(year)}
            owner={owner}
            onOpen={setOpen}
          />
        </>
      )}

      {open?.kind === 'year' ? (
        <YearDialog year={open.year} years={yearList} onClose={close} onSaved={pick} />
      ) : null}
      {open?.kind === 'term' ? (
        <TermDialog
          year={open.year}
          term={open.term}
          terms={yearTerms}
          classes={open.term ? allClasses.filter((c) => c.termId === open.term!.id).length : 0}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteTerm' ? (
        <DeleteTerm
          term={open.term}
          classes={classes.isSuccess ? allClasses.filter((c) => c.termId === open.term.id) : null}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'holiday' ? <HolidayDialog onClose={close} /> : null}
      {open?.kind === 'deleteHoliday' ? (
        <DeleteHoliday holiday={open.holiday} onClose={close} />
      ) : null}
      {open?.kind === 'invoices' ? (
        <RunInvoicesDialog open termId={open.term.id} onClose={close} />
      ) : null}
    </div>
  );
}

/** Where `today` falls against a range: before it, in it, or after it. */
function phase(r: Range, today: string) {
  return r.endDate < today ? 'past' : r.startDate > today ? 'ahead' : 'now';
}

/** The year card (Figma `th-year-card`): its dates, a timeline of its terms and holidays. */
function YearCard({
  year,
  terms,
  holidays,
  owner,
  onOpen,
}: {
  year: AcademicYear;
  terms: Term[];
  holidays: Holiday[];
  owner: boolean;
  onOpen: (open: Open) => void;
}) {
  const format = useFormat();
  const when = phase(year, format.today);
  const sameYear = year.startDate.slice(0, 4) === year.endDate.slice(0, 4);
  const dates = sameYear
    ? `${format.dayShort(year.startDate)} – ${format.dayShort(year.endDate)} ${year.endDate.slice(0, 4)}`
    : `${format.dayShort(year.startDate)} ${year.startDate.slice(0, 4)} – ${format.dayShort(year.endDate)} ${year.endDate.slice(0, 4)}`;
  return (
    <Card flush>
      <div className="flex min-h-16 items-center gap-2.5 border-b border-border px-4 py-3 sm:px-[18px]">
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-medium text-text">
            {t('terms.year.title', { name: year.name })}
          </h2>
          <p className="mt-0.5 text-meta text-muted">{dates}</p>
        </div>
        <Badge tone={when === 'now' ? 'success' : when === 'ahead' ? 'info' : 'neutral'}>
          {t(`terms.phase.${when}`)}
        </Badge>
        {owner ? (
          <Button
            variant="ghost"
            aria-label={t('terms.year.edit', { name: year.name })}
            onClick={() => onOpen({ kind: 'year', year })}
          >
            {t('terms.edit')}
          </Button>
        ) : null}
      </div>
      <Timeline year={year} terms={terms} holidays={holidays} />
      <div className="flex min-h-[54px] flex-col items-start gap-1 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-[18px]">
        {owner ? (
          <button
            type="button"
            onClick={() => onOpen({ kind: 'year' })}
            className="flex min-h-11 items-center text-label font-semibold text-brand hover:underline sm:min-h-0"
          >
            {t('terms.year.add')}
          </button>
        ) : (
          <span />
        )}
        <small className="text-meta text-muted">{t('terms.year.rules')}</small>
      </div>
    </Card>
  );
}

/**
 * The year at a glance: its terms as blocks, its holidays as amber marks and today as a line.
 * The terms and holidays lists below say the same in words, so this is hidden from screen readers.
 */
function Timeline({
  year,
  terms,
  holidays,
}: {
  year: AcademicYear;
  terms: Term[];
  holidays: Holiday[];
}) {
  const format = useFormat();
  const days = daysIn(year);
  const at = (date: string) =>
    (Math.min(Math.max(diffDays(year.startDate, date), 0), days) / days) * 100;
  const span = (r: Range) => ({
    left: `${at(r.startDate)}%`,
    width: `${at(addDays(r.endDate, 1)) - at(r.startDate)}%`,
  });
  return (
    <div
      aria-hidden
      className="relative m-4 h-[38px] overflow-hidden rounded-lg bg-canvas sm:m-[18px] sm:h-[90px]"
    >
      {terms.map((term, i) => (
        <i
          key={term.id}
          title={term.name}
          className="absolute top-[9px] grid h-[18px] place-items-center bg-brand text-meta text-white not-italic sm:top-6 sm:h-[30px]"
          style={span(term)}
        >
          <span className="hidden sm:inline">{`T${i + 1}`}</span>
        </i>
      ))}
      {holidays.map((h) => (
        <b
          key={h.id}
          title={h.name}
          className="absolute top-[5px] h-7 min-w-[3px] bg-warning sm:top-[18px] sm:h-[42px]"
          style={span(h)}
        />
      ))}
      {phase(year, format.today) === 'now' ? (
        <span
          className="absolute top-0.5 h-[34px] border-l-2 border-brand pl-1 text-meta text-brand sm:top-1 sm:h-16"
          style={{ left: `${at(format.today)}%` }}
        >
          <span className="hidden sm:inline">{t('terms.today')}</span>
        </span>
      ) : null}
    </div>
  );
}

/** The year's terms (Figma `th-list-card`), each with its length, classes and where it's at. */
function TermsCard({
  year,
  terms,
  classes,
  classesLoaded,
  owner,
  onOpen,
}: {
  year: AcademicYear;
  terms: Term[];
  classes: Class[];
  classesLoaded: boolean;
  owner: boolean;
  onOpen: (open: Open) => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const range = useRange();
  const today = format.today;
  // Invoices are run for the next term to start, else the one that's on.
  const billable = can(membership.role, 'billing:write')
    ? (terms.find((term) => term.startDate > today) ??
      terms.find((term) => phase(term, today) === 'now'))
    : undefined;

  return (
    <Card flush className="mt-4">
      <div className="flex min-h-16 items-center border-b border-border px-4 py-3 sm:px-[18px]">
        <h2 className="text-section font-medium text-text">{t('terms.terms')}</h2>
      </div>
      {terms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <CalendarRange className="size-5 text-brand" aria-hidden />
          <p className="max-w-[440px] text-body text-muted">
            {t('terms.none', { year: year.name })}
          </p>
          {owner ? (
            <Button
              variant="secondary"
              className="mt-2"
              icon={<Plus className="size-4" />}
              onClick={() => onOpen({ kind: 'term', year })}
            >
              {t('terms.add')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul>
          {terms.map((term) => {
            const weeks = count(weeksIn(term), 'terms.weeks.one', 'terms.weeks');
            const used = classesLoaded
              ? count(
                  classes.filter((c) => c.termId === term.id).length,
                  'branches.classes.one',
                  'branches.classes',
                )
              : '';
            return (
              <li
                key={term.id}
                className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-2.5 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0 md:min-h-16 md:grid-cols-[minmax(140px,1fr)_84px_84px_minmax(150px,auto)_112px_40px]"
              >
                <span className="flex min-w-0 flex-col">
                  <b className="truncate text-body font-semibold text-text">{term.name}</b>
                  <small className="mt-0.5 text-meta text-muted">
                    {range(term)}
                    <span className="md:hidden">
                      {` · ${[weeks, used].filter(Boolean).join(' · ')}`}
                    </span>
                  </small>
                </span>
                <span className="hidden text-label text-muted md:block">{weeks}</span>
                <span className="hidden text-label text-muted md:block">{used}</span>
                <span className="justify-self-end md:justify-self-start">
                  <TermStatus term={term} />
                </span>
                {billable?.id === term.id ? (
                  <button
                    type="button"
                    onClick={() => onOpen({ kind: 'invoices', term })}
                    className="col-span-2 col-start-1 row-start-2 flex min-h-11 items-center gap-1 justify-self-start text-label font-semibold text-brand hover:underline md:col-span-1 md:col-start-auto md:row-start-auto md:min-h-0"
                  >
                    {t('terms.runInvoices')}
                    <ArrowRight className="size-4" aria-hidden />
                  </button>
                ) : (
                  <span className="hidden md:block" />
                )}
                {owner ? (
                  <span className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                    <OverflowMenu
                      label={t('terms.actions', { name: term.name })}
                      items={[
                        {
                          label: t('terms.term.edit'),
                          onSelect: () => onOpen({ kind: 'term', year, term }),
                        },
                        {
                          label: t('terms.term.delete'),
                          danger: true,
                          onSelect: () => onOpen({ kind: 'deleteTerm', term }),
                        },
                      ]}
                    />
                  </span>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Finished, "Now · Week 7 of 10", or "Upcoming · Starts in 2 weeks". */
function TermStatus({ term }: { term: Term }) {
  const format = useFormat();
  const today = format.today;
  const when = phase(term, today);
  if (when === 'past') return <Badge>{t('terms.status.finished')}</Badge>;
  if (when === 'now') {
    const weeks = weeksIn(term);
    const week = Math.min(Math.floor(diffDays(term.startDate, today) / 7) + 1, weeks);
    return <Badge tone="success">{t('terms.status.now', { week, weeks })}</Badge>;
  }
  const days = diffDays(today, term.startDate);
  return (
    <Badge tone="info">
      {days === 1
        ? t('terms.status.tomorrow')
        : days < 14
          ? t('terms.status.days', { n: days })
          : t('terms.status.weeks', { n: Math.round(days / 7) })}
    </Badge>
  );
}

/** The holidays (Figma `th-holiday-row`), by month; past ones are faded. */
function HolidaysCard({
  holidays,
  byMonthOnly,
  owner,
  onOpen,
}: {
  holidays: Holiday[];
  /** Under a year, months need no year of their own. */
  byMonthOnly: boolean;
  owner: boolean;
  onOpen: (open: Open) => void;
}) {
  const format = useFormat();
  const range = useRange();
  const branches = useBranches();
  const branchName = new Map(branches.data?.data.map((b) => [b.id, b.name]));
  const months = new Map<string, Holiday[]>();
  for (const h of holidays) {
    const month = h.startDate.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), h]);
  }

  return (
    <Card flush className="mt-4">
      <div className="flex min-h-16 items-center gap-2.5 border-b border-border px-4 py-3 sm:px-[18px]">
        <h2 className="flex-1 text-section font-medium text-text">{t('terms.holidays')}</h2>
        {owner ? (
          <Button
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => onOpen({ kind: 'holiday' })}
          >
            {t('terms.holiday.add')}
          </Button>
        ) : null}
      </div>
      {holidays.length === 0 ? (
        <p className="flex flex-col items-center gap-2 px-5 py-10 text-center text-body text-muted">
          <CalendarRange className="size-5 text-brand" aria-hidden />
          {t('terms.holiday.none')}
        </p>
      ) : (
        [...months].map(([month, list]) => (
          <section key={month}>
            <h3 className="bg-canvas px-4 py-2 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
              {byMonthOnly ? format.monthName(month) : format.month(month)}
            </h3>
            <ul>
              {list.map((h) => {
                const days = count(daysIn(h), 'terms.days.one', 'terms.days');
                const past = h.endDate < format.today;
                return (
                  <li
                    key={h.id}
                    className={cn(
                      'grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-2.5 border-b border-border px-4 py-2 md:grid-cols-[minmax(0,1fr)_80px_minmax(130px,auto)_40px]',
                      past && 'opacity-65',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-body font-semibold text-text">{h.name}</b>
                      <small className="mt-0.5 text-meta text-muted">
                        {range(h, true)}
                        <span className="md:hidden"> · {days}</span>
                      </small>
                    </span>
                    <span className="hidden text-label text-muted md:block">{days}</span>
                    <span className="justify-self-end md:justify-self-start">
                      {h.branchId ? (
                        <Badge tone="info">
                          <MapPin className="size-3.5" aria-hidden />
                          {t('terms.holiday.branchOnly', {
                            name: branchName.get(h.branchId) ?? '',
                          })}
                        </Badge>
                      ) : (
                        <Badge>{t('terms.holiday.allBranches')}</Badge>
                      )}
                    </span>
                    {owner ? (
                      <OverflowMenu
                        label={t('terms.actions', { name: h.name })}
                        items={[
                          {
                            label: t('terms.holiday.delete'),
                            danger: true,
                            onSelect: () => onOpen({ kind: 'deleteHoliday', holiday: h }),
                          },
                        ]}
                      />
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Card>
  );
}

/** The required fields left empty, and an end before its start, before anything is sent. */
function checkDates(name: string, start: string, end: string, endOptional = false) {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = t('courses.error.required');
  if (!isDate(start)) errors.startDate = t('courses.error.required');
  if (!endOptional && !isDate(end)) errors.endDate = t('courses.error.required');
  if (isDate(start) && isDate(end) && end < start) errors.endDate = t('terms.error.endBeforeStart');
  return errors;
}

/** The dialog's save button and cancel. */
function Actions({
  form,
  label,
  saving,
  onClose,
}: {
  form: string;
  label: string;
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" form={form} loading={saving}>
        {label}
      </Button>
    </>
  );
}

/**
 * Add an academic year, or change one. Years can't overlap, and a year can't shrink past its
 * terms: the API says which (422), and that shows in the dialog. Years aren't deleted.
 */
function YearDialog({
  year,
  years,
  onClose,
  onSaved,
}: {
  year?: AcademicYear;
  years: AcademicYear[];
  onClose: () => void;
  onSaved: (year: AcademicYear) => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCalendar();
  const range = useRange();
  const [name, setName] = useState(year?.name ?? '');
  const [start, setStart] = useState(year?.startDate ?? '');
  const [end, setEnd] = useState(year?.endDate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const other = years.find(
    (y) =>
      y.id !== year?.id &&
      isDate(start) &&
      isDate(end) &&
      overlaps(y, { startDate: start, endDate: end }),
  );
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), startDate: start, endDate: end };
      return year
        ? api<AcademicYear>('PATCH', orgApiPath(membership, `/academic-years/${year.id}`), {
            body: { updatedAt: year.updatedAt, ...body },
          })
        : api<AcademicYear>('POST', orgApiPath(membership, '/academic-years'), { body });
    },
    onSuccess: async (saved) => {
      await refresh();
      toast(t(year ? 'terms.year.saved' : 'terms.year.added'));
      onSaved(saved);
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === 'conflict';
  const fields = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = checkDates(name, start, end);
    setErrors(next);
    if (!Object.keys(next).length && !other) save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(year ? 'terms.year.editTitle' : 'terms.year.add')}
      subtitle={year ? undefined : t('terms.year.addHelp')}
      actions={
        <Actions
          form="year-form"
          label={t(year ? 'branches.save' : 'terms.year.add')}
          saving={save.isPending}
          onClose={onClose}
        />
      }
    >
      <form id="year-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('branches.field.name')}
          required
          maxLength={120}
          value={name}
          placeholder={t('terms.year.namePlaceholder')}
          error={
            errors.name ?? (taken ? t('terms.error.yearTaken', { name: name.trim() }) : fields.name)
          }
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('terms.field.start')}
            required
            type="date"
            value={start}
            error={errors.startDate ?? fields.startDate}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={t('terms.field.end')}
            required
            type="date"
            value={end}
            error={
              errors.endDate ??
              (other
                ? t('terms.error.overlaps', { name: other.name, dates: range(other) })
                : fields.endDate)
            }
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {!taken ? (
          <StaleOrError error={save.error} onReload={() => void refresh().then(onClose)} />
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Add a term to a year, or change one. A term sits inside its year and doesn't overlap the
 * year's other terms: both are checked here as the dates change, and by the API.
 */
function TermDialog({
  year,
  term,
  terms,
  classes,
  onClose,
}: {
  year: AcademicYear;
  term?: Term;
  terms: Term[];
  classes: number;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCalendar();
  const range = useRange();
  const [name, setName] = useState(term?.name ?? '');
  const [start, setStart] = useState(term?.startDate ?? '');
  const [end, setEnd] = useState(term?.endDate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dates =
    isDate(start) && isDate(end) && end >= start ? { startDate: start, endDate: end } : null;
  const other = dates && terms.find((o) => o.id !== term?.id && overlaps(o, dates));
  const outside = dates && (dates.startDate < year.startDate || dates.endDate > year.endDate);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), startDate: start, endDate: end };
      return term
        ? api('PATCH', orgApiPath(membership, `/terms/${term.id}`), {
            body: { updatedAt: term.updatedAt, ...body },
          })
        : api('POST', orgApiPath(membership, '/terms'), {
            body: { academicYearId: year.id, ...body },
          });
    },
    onSuccess: async () => {
      await refresh();
      toast(t(term ? 'terms.term.saved' : 'terms.term.added'));
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === 'conflict';
  const fields = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = checkDates(name, start, end);
    setErrors(next);
    if (!Object.keys(next).length && !other && !outside) save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(term ? 'terms.term.edit' : 'terms.add')}
      actions={
        <Actions
          form="term-form"
          label={t(term ? 'branches.save' : 'terms.add')}
          saving={save.isPending}
          onClose={onClose}
        />
      }
    >
      <form id="term-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2.5 text-label">
          <span className="text-muted">{t('terms.field.year')}</span>
          <b className="font-semibold text-text">{year.name}</b>
        </div>
        <TextField
          label={t('branches.field.name')}
          required
          maxLength={120}
          value={name}
          placeholder={t('terms.term.namePlaceholder')}
          error={
            errors.name ??
            (taken
              ? t('terms.error.termTaken', { name: name.trim(), year: year.name })
              : fields.name)
          }
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('terms.field.start')}
            required
            type="date"
            min={year.startDate}
            max={year.endDate}
            value={start}
            error={errors.startDate ?? fields.startDate}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={t('terms.field.end')}
            required
            type="date"
            min={year.startDate}
            max={year.endDate}
            value={end}
            error={
              errors.endDate ??
              (other
                ? t('terms.error.overlaps', { name: other.name, dates: range(other) })
                : outside
                  ? t('terms.error.outside', { year: year.name, dates: range(year) })
                  : fields.endDate)
            }
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {dates && !other && !outside ? (
          <p className="-mt-1 text-meta text-muted">
            {`${count(weeksIn(dates), 'terms.weeks.one', 'terms.weeks')} · ${range(dates)}`}
          </p>
        ) : null}
        {term && classes > 0 ? (
          <Notice tone="info">
            {t(classes === 1 ? 'terms.term.inUse.one' : 'terms.term.inUse', { n: classes })}
          </Notice>
        ) : null}
        {!taken ? (
          <StaleOrError error={save.error} onReload={() => void refresh().then(onClose)} />
        ) : null}
      </form>
    </Dialog>
  );
}

/** Every page of the lessons in a range, as the timetable reads them. */
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

/**
 * Add a holiday: the whole centre, or one branch, is closed on those days. The lessons already
 * on the timetable then, and not yet started, are removed by the API; they're listed here first.
 */
function HolidayDialog({ onClose }: { onClose: () => void }) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const refresh = useRefreshCalendar();
  const branches = useBranches();
  const branchList = branches.data?.data ?? [];
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [branchId, setBranchId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const last = isDate(end) ? end : start;
  const dates = isDate(start) && last >= start ? { from: start, to: last } : null;
  const now = localNow(org?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

  const lessons = useQuery({
    queryKey: ['sessions', membership.org.id, { ...dates, branchId, closing: true }],
    queryFn: ({ signal }) =>
      allSessions(
        orgApiPath(membership, `/sessions${query({ ...dates, branchId, limit: 200 })}`),
        signal,
      ),
    enabled: Boolean(dates),
  });
  // What the API removes: scheduled lessons that haven't started.
  const closing = (lessons.data ?? []).filter(
    (s) =>
      s.status === 'scheduled' &&
      (s.date > now.date || (s.date === now.date && s.startTime > now.time)),
  );

  const save = useMutation({
    mutationFn: () =>
      api('POST', orgApiPath(membership, '/holidays'), {
        body: {
          name: name.trim(),
          startDate: start,
          endDate: last,
          ...(branchId ? { branchId } : {}),
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('terms.holiday.added'));
      onClose();
    },
  });
  const fields = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = checkDates(name, start, end, true);
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  }

  const list = new Intl.ListFormat(org?.locale ?? 'en-NZ');
  const scopes = [
    {
      id: '',
      name: t('terms.holiday.allBranches'),
      meta: list.format(branchList.map((b) => b.name)),
    },
    ...branchList.map((b) => ({ id: b.id, name: b.name, meta: t('terms.holiday.thisBranch') })),
  ];
  const shown = closing.slice(0, 2).map((s) =>
    t('terms.holiday.lesson', {
      name: s.className,
      day: format.day(s.date),
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('terms.holiday.add')}
      actions={
        <Actions
          form="holiday-form"
          label={t('terms.holiday.add')}
          saving={save.isPending}
          onClose={onClose}
        />
      }
    >
      <form id="holiday-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('branches.field.name')}
          required
          maxLength={120}
          value={name}
          placeholder={t('terms.holiday.namePlaceholder')}
          error={errors.name ?? fields.name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('terms.field.from')}
            required
            type="date"
            value={start}
            error={errors.startDate ?? fields.startDate}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={t('terms.field.to')}
            type="date"
            min={start || undefined}
            value={end}
            helper={t('terms.field.toHelp')}
            error={errors.endDate ?? fields.endDate}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {branchList.length > 1 ? (
          <fieldset>
            <legend className="mb-1.5 text-label font-medium text-text">
              {t('terms.field.appliesTo')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {scopes.map((scope) => (
                <label
                  key={scope.id || 'all'}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
                    branchId === scope.id
                      ? 'border-brand bg-brand-soft'
                      : 'border-border-strong bg-surface hover:bg-canvas',
                  )}
                >
                  <input
                    type="radio"
                    name="applies-to"
                    checked={branchId === scope.id}
                    onChange={() => setBranchId(scope.id)}
                    className="sr-only"
                  />
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <b className="text-label font-semibold text-text">{scope.name}</b>
                    <small className="text-meta text-muted">{scope.meta}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {dates && lessons.isSuccess ? (
          closing.length ? (
            <Notice
              tone="warning"
              title={t(
                closing.length === 1 ? 'terms.holiday.removes.one' : 'terms.holiday.removes',
                {
                  n: closing.length,
                },
              )}
            >
              <p>
                {closing.length > 2
                  ? t('terms.holiday.lessonsMore', {
                      lessons: shown.join(', '),
                      n: closing.length - 2,
                    })
                  : `${list.format(shown)}.`}
              </p>
              <p className="mt-1 text-meta text-muted">{t('terms.holiday.noComeBack')}</p>
            </Notice>
          ) : (
            <p className="text-meta text-muted">{t('terms.holiday.noLessons')}</p>
          )
        ) : null}
        <StaleOrError error={save.error} onReload={() => void refresh().then(onClose)} />
      </form>
    </Dialog>
  );
}

/** "Delete Term 4?" Refused while a class runs in it: those classes are listed, to move. */
function DeleteTerm({
  term,
  classes,
  onClose,
}: {
  term: Term;
  /** null while the classes load. */
  classes: Class[] | null;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCalendar();
  const paths = useClassPaths();
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, `/terms/${term.id}`)),
    onSuccess: async () => {
      await refresh();
      toast(t('branches.deleted', { name: term.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('terms.term.deleteTitle', { name: term.name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={run.isPending}
            disabled={!classes || classes.length > 0}
            onClick={() => run.mutate()}
          >
            {t('terms.term.delete')}
          </Button>
        </>
      }
    >
      {!classes ? (
        <p className="text-body text-muted">{t('common.loading')}</p>
      ) : classes.length ? (
        <Notice
          tone="danger"
          title={t(classes.length === 1 ? 'terms.term.usedBy.one' : 'terms.term.usedBy', {
            name: term.name,
            n: classes.length,
          })}
        >
          <ul className="mt-1 flex flex-col gap-1">
            {classes.map((c) => (
              <li key={c.id}>
                <Link to={paths.class(c.id)} className="underline hover:no-underline">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2">{t('terms.term.moveFirst')}</p>
        </Notice>
      ) : (
        <p className="text-body text-text">{t('terms.term.unused')}</p>
      )}
      <StaleOrError error={run.error} onReload={() => void refresh().then(onClose)} />
    </Dialog>
  );
}

/** "Delete Easter?" The lessons it removed stay removed. */
function DeleteHoliday({ holiday, onClose }: { holiday: Holiday; onClose: () => void }) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshCalendar();
  const range = useRange();
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, `/holidays/${holiday.id}`)),
    onSuccess: async () => {
      await refresh();
      toast(t('branches.deleted', { name: holiday.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('terms.holiday.deleteTitle', { name: holiday.name })}
      subtitle={range(holiday, true)}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
            {t('terms.holiday.delete')}
          </Button>
        </>
      }
    >
      <p className="text-body text-text">{t('terms.holiday.deleteBody')}</p>
      <StaleOrError error={run.error} onReload={() => void refresh().then(onClose)} />
    </Dialog>
  );
}
