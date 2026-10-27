import type { Family, Payment, PaymentMethod } from '@edustrux/shared';
import { PAYMENT_METHODS } from '@edustrux/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CreditCard, Plus, Users, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/FilterSelect';
import { PageError, PageHeader } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useBillingPaths } from '../../lib/billing';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { EmptyState, SkeletonRows } from '../people/parts';
import { DeletePaymentDialog } from './InvoicePage';
import { Method, openPdf } from './parts';
import { RecordPaymentDialog } from './RecordPaymentDialog';

/** Payments (TUI-119): the money recorded, newest first, by family and method. */
export function PaymentsPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'billing:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Payments />;
}

function Payments() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const canWrite = can(membership.role, 'billing:write');
  const familyId = params.get('family') ?? '';
  const method = (PAYMENT_METHODS as readonly string[]).includes(params.get('method') ?? '')
    ? (params.get('method') as PaymentMethod)
    : '';

  const families = useQuery({
    queryKey: ['families', membership.org.id, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<Family>>('GET', orgApiPath(membership, '/families?limit=200'), { signal }),
    enabled: can(membership.role, 'people:read'),
    staleTime: 60_000,
  });
  const list = useInfiniteQuery({
    queryKey: ['payments', membership.org.id, { familyId, method }],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Payment>>(
        'GET',
        orgApiPath(
          membership,
          `/payments${query({ limit: 50, familyId, method, cursor: pageParam })}`,
        ),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  function set(next: Record<string, string>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated, { replace: true });
  }

  const shown = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);

  return (
    <>
      <PageHeader
        overline={t('billing.overline')}
        title={t('billing.payments.page')}
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setPaying(true)}>
              {t('billing.recordPayment')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2 pb-4">
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
        <FilterSelect
          Icon={CreditCard}
          label={t('billing.filter.method')}
          value={method}
          onChange={(value) => set({ method: value })}
          options={[
            { value: '', label: t('billing.filter.allMethods') },
            ...PAYMENT_METHODS.map((m) => ({ value: m, label: t(`people.method.${m}`) })),
          ]}
        />
      </div>

      <Card flush className="overflow-hidden">
        {list.isPending ? (
          <SkeletonRows />
        ) : list.isError ? (
          <PageError error={list.error} onRetry={() => void list.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            Icon={Wallet}
            title={
              familyId || method ? t('billing.payments.emptyFiltered') : t('billing.payments.empty')
            }
          />
        ) : (
          <PaymentRows rows={shown} onDelete={canWrite ? setDeleting : undefined} />
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

      <RecordPaymentDialog open={paying} onClose={() => setPaying(false)} />
      {deleting ? (
        <DeletePaymentDialog payment={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}

// Method and reference join the columns only on wide screens, so the row fits beside the sidebar.
const GRID =
  'md:grid md:grid-cols-[minmax(96px,0.7fr)_minmax(150px,1.2fr)_minmax(150px,1.4fr)_minmax(90px,0.7fr)_40px] xl:grid-cols-[minmax(96px,0.7fr)_minmax(150px,1.2fr)_minmax(130px,1fr)_minmax(100px,0.8fr)_minmax(170px,1.4fr)_minmax(90px,0.7fr)_40px]';

function PaymentRows({
  rows,
  onDelete,
}: {
  rows: Payment[];
  onDelete?: (payment: Payment) => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const paths = useBillingPaths();

  /** "INV-0042, INV-0043": each invoice it paid, by number, linked. */
  function towards(payment: Payment) {
    if (payment.allocations.length === 0) return '—';
    return payment.allocations.map((a, i) => (
      <span key={a.invoiceId}>
        {i > 0 ? ', ' : null}
        <Link to={paths.invoice(a.invoiceId)} className="text-brand hover:underline">
          {a.invoiceNumber ?? t('billing.payments.anInvoice')}
        </Link>
      </span>
    ));
  }

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'hidden h-[42px] items-center gap-4 border-b border-border bg-[#fafbfb] px-4 text-meta font-semibold text-muted',
          GRID,
        )}
      >
        <span>{t('billing.col.received')}</span>
        <span>{t('billing.col.family')}</span>
        <span className="hidden xl:block">{t('billing.col.method')}</span>
        <span className="hidden xl:block">{t('billing.col.reference')}</span>
        <span>{t('billing.col.towards')}</span>
        <span className="text-right">{t('billing.col.amount')}</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((payment) => {
          const items: MenuItem[] = [
            {
              label: t('billing.receipt'),
              onSelect: () =>
                void openPdf(orgApiPath(membership, `/payments/${payment.id}/receipt`), toast),
            },
          ];
          if (onDelete) {
            items.push({
              label: t('billing.deletePayment.menu'),
              onSelect: () => onDelete(payment),
              danger: true,
            });
          }
          return (
            <li
              key={payment.id}
              className={cn(
                'flex min-h-[64px] items-center gap-3 py-2 pr-2 pl-4 text-body text-text md:min-h-[56px] md:gap-4',
                GRID,
              )}
            >
              <span className="hidden md:block">{format.date(payment.receivedOn)}</span>
              <span className="flex min-w-0 flex-1 flex-col md:flex-none">
                <b className="truncate font-semibold">
                  {t('people.familyName', { name: payment.familyName })}
                </b>
                <small className="truncate text-meta text-muted xl:hidden">
                  {t(`people.method.${payment.method}`)} · {format.date(payment.receivedOn)}
                </small>
              </span>
              <span className="hidden xl:block">
                <Method method={payment.method} />
              </span>
              <span className="hidden truncate text-muted xl:block">
                {payment.reference ?? '—'}
              </span>
              <span className="hidden truncate md:block">{towards(payment)}</span>
              <b className="shrink-0 text-right font-semibold tabular-nums">
                {format.money(payment.amount)}
              </b>
              <OverflowMenu label={t('billing.paymentActions')} items={items} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
