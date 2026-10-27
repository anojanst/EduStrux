import type { Family, Invoice, InvoiceStatus } from '@edustrux/shared';
import { INVOICE_STATUSES } from '@edustrux/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronRight, MapPin, Plus, ReceiptText, Users, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError, PageHeader } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import {
  invoiceStatus,
  periodLabel,
  studentNames,
  useBillingPaths,
  useRefreshBilling,
} from '../../lib/billing';
import { useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, useBranches, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { ConfirmDialog } from '../people/dialogs';
import { EmptyState, SkeletonRows } from '../people/parts';
import { InvoiceBadge, MoneyStats } from './parts';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { RunInvoicesDialog } from './RunInvoicesDialog';

/**
 * Invoices (TUI-119): every invoice the caller reaches, by status, period, family and branch.
 * Staff who bill run invoices, issue drafts and record payments; the accountant reads.
 */
export function InvoicesPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'billing:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Invoices />;
}

/** A period filter value: a term id, or `month:2026-11`. */
const MONTH = 'month:';

function Invoices() {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useBillingPaths();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<'run' | 'pay' | 'issue' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canWrite = can(membership.role, 'billing:write');

  const terms = useTerms();
  const branches = useBranches();
  const families = useQuery({
    queryKey: ['families', membership.org.id, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<Family>>('GET', orgApiPath(membership, '/families?limit=200'), { signal }),
    enabled: can(membership.role, 'people:read'),
    staleTime: 60_000,
  });

  const status = (INVOICE_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as InvoiceStatus)
    : '';
  const period = params.get('period') ?? '';
  const familyId = params.get('family') ?? '';
  const branchId = params.get('branch') ?? '';
  const termId = period.startsWith(MONTH) ? '' : period;
  const month = period.startsWith(MONTH) ? period.slice(MONTH.length) : '';
  const own = membership.branchIds;
  const branchChoices = (branches.data?.data ?? []).filter((b) => !own || own.includes(b.id));

  function set(next: Record<string, string>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated, { replace: true });
    setSelected(new Set());
  }

  const list = useInfiniteQuery({
    queryKey: ['invoices', membership.org.id, { status, termId, month, familyId, branchId }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Invoice>>(
        'GET',
        orgApiPath(
          membership,
          `/invoices${query({ limit: 50, status, termId, month, familyId, branchId, cursor: pageParam })}`,
        ),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const drafts = rows.filter((i) => i.status === 'draft' && selected.has(i.id));
  const filtered = Boolean(status || period || familyId || branchId);

  // The months on the invoices loaded so far, newest first, beside the org's terms.
  const months = [...new Set(rows.flatMap((i) => (i.month ? [i.month] : [])))];
  if (month && !months.includes(month)) months.push(month);
  months.sort().reverse();
  const subtitle = [
    period
      ? month
        ? format.month(month)
        : (terms.data?.data.find((x) => x.id === termId)?.name ?? '')
      : t('billing.allPeriods'),
    branchId
      ? (branchChoices.find((b) => b.id === branchId)?.name ?? '')
      : branchChoices.length > 1
        ? t('people.filter.allBranches')
        : '',
  ]
    .filter(Boolean)
    .join(' · ');

  function toggle(id: string) {
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        overline={t('billing.overline')}
        title={t('billing.invoices.title')}
        subtitle={subtitle}
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<Wallet className="size-4" />}
                onClick={() => setOpen('pay')}
              >
                {t('billing.recordPayment')}
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => setOpen('run')}>
                {t('billing.run.button')}
              </Button>
            </div>
          ) : null
        }
      />

      <MoneyStats draftsTo={`${paths.invoices}?status=draft`} />

      <div className="flex flex-col gap-3 pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div
          role="group"
          aria-label={t('billing.filter.status')}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {(['', ...INVOICE_STATUSES] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              aria-pressed={status === value}
              onClick={() => set({ status: value })}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 text-label whitespace-nowrap transition-colors',
                status === value
                  ? 'border-brand bg-brand-soft font-semibold text-brand'
                  : 'border-border-strong bg-surface text-secondary-text hover:bg-canvas',
              )}
            >
              {value ? t(`invoice.status.${value}`) : t('billing.filter.all')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            Icon={CalendarDays}
            label={t('billing.filter.period')}
            value={period}
            onChange={(value) => set({ period: value })}
            options={[
              { value: '', label: t('billing.allPeriods') },
              ...(terms.data?.data ?? []).map((term) => ({ value: term.id, label: term.name })),
              ...months.map((m) => ({ value: `${MONTH}${m}`, label: format.month(m) })),
            ]}
          />
          {families.data && families.data.data.length > 1 ? (
            <FilterSelect
              Icon={Users}
              label={t('billing.filter.family')}
              value={familyId}
              onChange={(value) => set({ family: value })}
              options={[
                { value: '', label: t('billing.filter.allFamilies') },
                ...[...families.data.data]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((f) => ({ value: f.id, label: t('people.familyName', { name: f.name }) })),
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
        </div>
      </div>

      {drafts.length ? (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-body text-text">
            <b className="font-semibold">
              {drafts.length === 1
                ? t('billing.selected.one')
                : t('billing.selected.many', { n: drafts.length })}
              {' · '}
              {format.money({
                amount: drafts.reduce((sum, i) => sum + i.total.amount, 0),
                currency: drafts[0]!.total.currency,
              })}
            </b>
            <p className="text-meta text-muted">{t('billing.issue.note')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              {t('billing.selected.clear')}
            </Button>
            <Button size="sm" onClick={() => setOpen('issue')}>
              {drafts.length === 1
                ? t('billing.issue.one')
                : t('billing.issue.many', { n: drafts.length })}
            </Button>
          </div>
        </div>
      ) : null}

      <Card flush className="overflow-hidden">
        {list.isPending ? (
          <SkeletonRows />
        ) : list.isError ? (
          <PageError error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState Icon={ReceiptText} title={t('billing.invoices.emptyFiltered')} />
          ) : (
            <EmptyState
              Icon={ReceiptText}
              title={t('billing.invoices.empty')}
              body={canWrite ? t('billing.invoices.emptyBody') : undefined}
              action={
                canWrite ? (
                  <Button icon={<Plus className="size-4" />} onClick={() => setOpen('run')}>
                    {t('billing.run.button')}
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <InvoiceRows rows={rows} selectable={canWrite} selected={selected} onToggle={toggle} />
        )}
      </Card>
      {list.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('billing.loadMore')}
          </Button>
        </div>
      ) : null}

      <RunInvoicesDialog open={open === 'run'} onClose={() => setOpen(null)} />
      <RecordPaymentDialog open={open === 'pay'} onClose={() => setOpen(null)} />
      {open === 'issue' ? (
        <IssueDialog
          invoices={drafts}
          onClose={() => setOpen(null)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
    </>
  );
}

const GRID =
  'md:grid md:grid-cols-[minmax(180px,1.5fr)_minmax(120px,1fr)_minmax(110px,0.8fr)_minmax(96px,0.7fr)_minmax(90px,0.7fr)_minmax(90px,0.7fr)_96px_16px]';

function InvoiceRows({
  rows,
  selectable,
  selected,
  onToggle,
}: {
  rows: Invoice[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const format = useFormat();
  const paths = useBillingPaths();
  const terms = useTerms().data?.data;
  const anyDraft = selectable && rows.some((i) => i.status === 'draft');

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'hidden h-[42px] items-center gap-4 border-b border-border bg-[#fafbfb] pr-4 text-meta font-semibold text-muted md:flex',
          anyDraft ? 'pl-12' : 'pl-4',
        )}
      >
        <div className={cn('w-full items-center gap-4', GRID)}>
          <span>{t('billing.col.family')}</span>
          <span>{t('billing.col.period')}</span>
          <span>{t('billing.col.number')}</span>
          <span>{t('billing.col.due')}</span>
          <span className="text-right">{t('billing.col.total')}</span>
          <span className="text-right">{t('billing.col.balance')}</span>
          <span>{t('billing.col.status')}</span>
          <span />
        </div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((invoice) => {
          const shown = invoiceStatus(invoice, format.today);
          const period = periodLabel(invoice, terms, format);
          const due = invoice.dueDate
            ? t('people.due', { date: format.date(invoice.dueDate) })
            : t('people.noDueDate');
          return (
            <li key={invoice.id} className="flex items-center">
              {anyDraft ? (
                <span className="flex w-10 shrink-0 justify-center self-stretch md:w-12">
                  {invoice.status === 'draft' ? (
                    <input
                      type="checkbox"
                      checked={selected.has(invoice.id)}
                      onChange={() => onToggle(invoice.id)}
                      aria-label={t('billing.select', { family: invoice.familyName, period })}
                      className="size-4 accent-brand"
                    />
                  ) : null}
                </span>
              ) : null}
              <Link
                to={paths.invoice(invoice.id)}
                className={cn(
                  'flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 text-body text-text hover:bg-canvas md:min-h-[56px] md:gap-4',
                  anyDraft ? 'pl-0' : 'pl-4',
                  GRID,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col md:flex-none">
                  <b className="truncate font-semibold">
                    {t('people.familyName', { name: invoice.familyName })}
                  </b>
                  <small className="truncate text-meta text-muted max-md:hidden">
                    {studentNames(invoice)}
                  </small>
                  {/* On phones the period and due date are the meta line; the columns are hidden. */}
                  <small className="truncate text-meta text-muted md:hidden">
                    {[invoice.number, period, due].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="hidden truncate md:block">{period}</span>
                <span
                  className={cn(
                    'hidden truncate md:block',
                    invoice.status === 'void' && 'text-muted line-through',
                  )}
                >
                  {invoice.number ?? <span className="text-subtle">—</span>}
                </span>
                <span className="hidden md:block">
                  {invoice.dueDate ? format.date(invoice.dueDate) : '—'}
                </span>
                <span className="hidden text-right tabular-nums md:block">
                  {format.money(invoice.total)}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 md:contents">
                  <span className="text-right font-semibold tabular-nums md:font-normal">
                    {format.money(invoice.balance)}
                  </span>
                  <span>
                    <InvoiceBadge status={shown} />
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Issue the chosen drafts, one after another: each family is sent theirs. */
function IssueDialog({
  invoices,
  onClose,
  onDone,
}: {
  invoices: Invoice[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshBilling();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      variant="primary"
      title={
        invoices.length === 1
          ? t('billing.issue.titleOne', { family: invoices[0]!.familyName })
          : t('billing.issue.titleMany', { n: invoices.length })
      }
      body={t('billing.issue.body')}
      action={
        invoices.length === 1
          ? t('billing.issue.one')
          : t('billing.issue.many', { n: invoices.length })
      }
      onConfirm={async () => {
        let failed = 0;
        for (const invoice of invoices) {
          try {
            await api('POST', orgApiPath(membership, `/invoices/${invoice.id}/issue`), {
              idempotencyKey: `issue-${invoice.id}-${invoice.updatedAt}`,
            });
          } catch {
            failed += 1;
          }
        }
        await refresh();
        onDone();
        const issued = invoices.length - failed;
        toast(
          failed
            ? t('billing.issue.partly', { issued, failed })
            : issued === 1
              ? t('billing.issue.doneOne')
              : t('billing.issue.doneMany', { n: issued }),
        );
      }}
    />
  );
}
