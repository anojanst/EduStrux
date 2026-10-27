import type { Invoice, InvoiceLine, Payment } from '@edustrux/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Download, Send, Wallet } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { PageError, PageLoading } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, TextField } from '../../components/ui/Field';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import {
  invoiceKey,
  invoiceStatus,
  periodLabel,
  useBillingPaths,
  useRefreshBilling,
} from '../../lib/billing';
import { useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { namesOf, query, useBranches, usePeoplePaths, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { ConfirmDialog, FormActions, StaleOrError } from '../people/dialogs';
import { CardEmpty, SectionCard } from '../people/parts';
import { InvoiceBadge, Method, openPdf } from './parts';
import { RecordPaymentDialog } from './RecordPaymentDialog';

type Format = ReturnType<typeof useFormat>;

/** One invoice (TUI-119): its lines, totals, details and the payments towards it. */
export function InvoicePage() {
  const { membership } = useOrg();
  const { invoiceId = '' } = useParams();
  if (!can(membership.role, 'billing:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <InvoiceDetail key={invoiceId} invoiceId={invoiceId} />;
}

type Open = 'edit' | 'issue' | 'void' | 'pay' | { deletePayment: Payment } | null;

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useBillingPaths();
  const toast = useToast();
  const refresh = useRefreshBilling();
  const terms = useTerms();
  const [open, setOpen] = useState<Open>(null);
  const canWrite = can(membership.role, 'billing:write');

  const invoice = useQuery({
    queryKey: invoiceKey(membership.org.id, invoiceId),
    queryFn: ({ signal }) =>
      api<Invoice>('GET', orgApiPath(membership, `/invoices/${invoiceId}`), { signal }),
  });
  const payments = useQuery({
    queryKey: ['payments', membership.org.id, { invoiceId }],
    queryFn: ({ signal }) =>
      api<Page<Payment>>(
        'GET',
        orgApiPath(membership, `/payments${query({ invoiceId, limit: 200 })}`),
        { signal },
      ),
  });

  if (invoice.isPending) return <PageLoading />;
  if (invoice.isError) {
    return <PageError error={invoice.error} onRetry={() => void invoice.refetch()} />;
  }
  const data = invoice.data;
  const status = invoiceStatus(data, format.today);
  const close = () => setOpen(null);
  const pdf = () => void openPdf(orgApiPath(membership, `/invoices/${data.id}/pdf`), toast);
  const paid = payments.data?.data ?? [];

  // The one main action for the status: issue a draft, take a payment on an open invoice.
  const main =
    !canWrite || data.status === 'void' || data.status === 'paid'
      ? null
      : data.status === 'draft'
        ? {
            label: t('billing.issue.action'),
            Icon: Send,
            onClick: () => setOpen('issue'),
          }
        : { label: t('billing.recordPayment'), Icon: Wallet, onClick: () => setOpen('pay') };
  const menu: MenuItem[] = [];
  if (main) menu.push({ label: t('billing.downloadPdf'), onSelect: pdf });
  if (canWrite && data.status !== 'void' && data.status !== 'paid') {
    menu.push({ label: t('billing.edit.menu'), onSelect: () => setOpen('edit') });
    // An invoice with payments can't be voided: its payments come off first.
    if (data.paid.amount === 0) {
      menu.push({ label: t('billing.void.menu'), onSelect: () => setOpen('void'), danger: true });
    }
  }

  const meta = [
    data.number,
    periodLabel(data, terms.data?.data, format),
    t('billing.period.dates', {
      start: format.date(data.periodStart),
      end: format.date(data.periodEnd),
    }),
    data.bankReference ? t('billing.ref', { ref: data.bankReference }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 md:items-end">
        <div className="min-w-0">
          <Link
            to={paths.invoices}
            className="inline-flex items-center gap-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase hover:underline"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            {t('billing.invoices.title')}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-title font-normal break-words text-text">
            {t('people.familyName', { name: data.familyName })}
            <InvoiceBadge status={status} />
          </h1>
          <p className="mt-1 text-body text-muted">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {main ? (
            <Button
              className="max-md:hidden"
              icon={<main.Icon className="size-4" />}
              onClick={main.onClick}
            >
              {main.label}
            </Button>
          ) : null}
          {!main ? (
            <Button
              variant="secondary"
              className="max-md:hidden"
              icon={<Download className="size-4" />}
              onClick={pdf}
            >
              {t('billing.downloadPdf')}
            </Button>
          ) : null}
          {menu.length ? <OverflowMenu label={t('billing.moreActions')} items={menu} /> : null}
        </div>
      </header>

      {data.status === 'void' ? (
        <Notice tone="info" className="mb-5">
          {data.voidedAt
            ? t('billing.voided', { date: format.stamp(data.voidedAt) })
            : t('billing.voidedNoDate')}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <Lines invoice={data} overdue={status === 'overdue'} />
        <div className="flex flex-col gap-5">
          <Details invoice={data} overdue={status === 'overdue'} />
          <SectionCard title={t('billing.payments.title')}>
            {payments.isPending ? (
              <div className="h-16 animate-pulse bg-canvas/60" aria-hidden />
            ) : payments.isError ? (
              <CardEmpty>{t('error.generic')}</CardEmpty>
            ) : paid.length === 0 ? (
              <CardEmpty>{t('billing.payments.none')}</CardEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {paid.map((payment) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    invoiceId={data.id}
                    onDelete={canWrite ? () => setOpen({ deletePayment: payment }) : undefined}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* On phones the main action, or the PDF when there's none, sits in a bar at the bottom. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {main ? (
          <Button className="w-full" icon={<main.Icon className="size-4" />} onClick={main.onClick}>
            {main.label}
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            icon={<Download className="size-4" />}
            onClick={pdf}
          >
            {t('billing.downloadPdf')}
          </Button>
        )}
      </div>

      {open === 'edit' ? <EditInvoiceDialog invoice={data} onClose={close} /> : null}
      {open === 'issue' ? (
        <ConfirmDialog
          open
          onClose={close}
          variant="primary"
          title={t('billing.issue.titleOne', { family: data.familyName })}
          body={t('billing.issue.body')}
          action={t('billing.issue.action')}
          onConfirm={async () => {
            await api('POST', orgApiPath(membership, `/invoices/${data.id}/issue`), {
              idempotencyKey: `issue-${data.id}-${data.updatedAt}`,
            });
            await refresh();
            toast(t('billing.issue.doneOne'));
          }}
        />
      ) : null}
      {open === 'void' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={t('billing.void.title', { family: data.familyName })}
          body={t('billing.void.body')}
          action={t('billing.void.action')}
          onConfirm={async () => {
            await api('POST', orgApiPath(membership, `/invoices/${data.id}/void`), {
              idempotencyKey: `void-${data.id}-${data.updatedAt}`,
            });
            await refresh();
            toast(t('billing.void.done'));
          }}
        />
      ) : null}
      <RecordPaymentDialog
        open={open === 'pay'}
        onClose={close}
        familyId={data.familyId}
        familyName={data.familyName}
        invoiceId={data.id}
      />
      {open && typeof open === 'object' ? (
        <DeletePaymentDialog payment={open.deletePayment} onClose={close} />
      ) : null}
    </>
  );
}

/** The lines by student, each class's charge and discounts, then the totals. */
function Lines({ invoice, overdue }: { invoice: Invoice; overdue: boolean }) {
  const format = useFormat();
  const byStudent = new Map<string, InvoiceLine[]>();
  for (const line of invoice.lines) {
    byStudent.set(line.studentId, [...(byStudent.get(line.studentId) ?? []), line]);
  }
  // One row per tax: "GST 15%", with what it adds across the lines.
  const taxes = new Map<string, number>();
  for (const line of invoice.lines) {
    if (!line.taxName || line.taxRateBps === null || line.tax.amount === 0) continue;
    const label = t('billing.tax', { name: line.taxName, rate: line.taxRateBps / 100 });
    taxes.set(label, (taxes.get(label) ?? 0) + line.tax.amount);
  }
  const currency = invoice.total.currency;

  return (
    <SectionCard title={t('billing.lines.title')}>
      {invoice.lines.length === 0 ? <CardEmpty>{t('billing.lines.none')}</CardEmpty> : null}
      {[...byStudent.values()].map((lines) => (
        <div key={lines[0]!.studentId}>
          <p className="border-b border-border bg-[#fafbfb] px-4 py-2 text-meta font-semibold tracking-[0.05em] text-muted uppercase">
            {lines[0]!.studentFirstName} {lines[0]!.studentLastName}
          </p>
          <ul className="divide-y divide-border border-b border-border">
            {lines.map((line) => (
              <li key={line.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex min-w-0 flex-col">
                    <b className="text-body font-semibold text-text">{line.className}</b>
                    <small className="text-meta text-muted">{lineMeta(line, format)}</small>
                  </span>
                  <span className="shrink-0 text-body font-semibold text-text tabular-nums">
                    {format.money({
                      amount: line.subtotal.amount + line.discount.amount,
                      currency: line.subtotal.currency,
                    })}
                  </span>
                </div>
                {line.discounts.map((discount) => (
                  <div
                    key={discount.ruleId}
                    className="mt-1.5 flex items-center justify-between gap-4 text-meta text-success"
                  >
                    <span>{discount.name}</span>
                    <span className="tabular-nums">−{format.money(discount.amount)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <dl className="flex flex-col gap-2 px-4 py-4 text-body sm:ml-auto sm:w-[320px]">
        <Total label={t('billing.subtotal')}>{format.money(invoice.subtotal)}</Total>
        {[...taxes].map(([label, amount]) => (
          <Total key={label} label={label}>
            {format.money({ amount, currency })}
          </Total>
        ))}
        <div className="my-1 border-t border-border" />
        <Total label={t('billing.total')} strong>
          {format.money(invoice.total)}
        </Total>
        <Total label={t('billing.paid')}>
          {invoice.paid.amount ? `−${format.money(invoice.paid)}` : format.money(invoice.paid)}
        </Total>
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <dt className={cn('text-section', overdue ? 'text-danger' : 'text-text')}>
            {t('billing.balance')}
          </dt>
          <dd
            className={cn(
              'text-stat font-bold tabular-nums',
              overdue ? 'text-danger' : 'text-text',
            )}
          >
            {format.money(invoice.balance)}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

function Total({
  label,
  strong = false,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'font-semibold text-text' : 'text-muted'}>{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-semibold text-text' : 'text-text')}>
        {children}
      </dd>
    </div>
  );
}

/** "8 lessons × $35.00", "6 of 8 lessons · term price $280.00", with free trial lessons. */
export function lineMeta(line: InvoiceLine, format: Format) {
  const price = format.money(line.unitPrice);
  let charge: string;
  if (line.basis === 'per_lesson') {
    charge = t('billing.line.perLesson', { n: line.quantity, price });
  } else if (line.basis === 'pack') {
    charge = t('billing.line.pack', { n: line.quantity, price, lessons: line.lessons });
  } else {
    const kind = line.basis === 'per_term' ? 'term' : 'month';
    charge =
      line.periodLessons !== null && line.lessons < line.periodLessons
        ? t(`billing.line.${kind}Part`, { n: line.lessons, of: line.periodLessons, price })
        : t(`billing.line.${kind}`, { price });
  }
  const parts = [charge];
  if (line.freeLessons > 0) {
    parts.push(
      line.freeLessons === 1
        ? t('billing.line.freeOne')
        : t('billing.line.freeMany', { n: line.freeLessons }),
    );
  }
  if (line.priceOverridden) parts.push(t('billing.line.override'));
  return parts.join(' · ');
}

function Details({ invoice, overdue }: { invoice: Invoice; overdue: boolean }) {
  const { membership } = useOrg();
  const format = useFormat();
  const people = usePeoplePaths();
  const branches = useBranches();
  const manyBranches = (branches.data?.data.length ?? 0) > 1;
  const days = invoice.dueDate ? -format.daysUntil(invoice.dueDate) : 0;

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t('billing.detail.family'),
      value: can(membership.role, 'people:read') ? (
        <Link to={people.family(invoice.familyId)} className="text-brand hover:underline">
          {t('people.familyName', { name: invoice.familyName })}
        </Link>
      ) : (
        t('people.familyName', { name: invoice.familyName })
      ),
    },
  ];
  if (manyBranches) {
    rows.push({
      label: t('billing.detail.branch'),
      value: namesOf(branches.data?.data)(invoice.branchId),
    });
  }
  rows.push({
    label: t('billing.detail.due'),
    value: invoice.dueDate ? (
      <span className="flex flex-wrap items-center gap-2">
        {format.date(invoice.dueDate)}
        {overdue ? (
          <Badge tone="danger">
            {days === 1 ? t('billing.overdueOne') : t('billing.overdueBy', { n: days })}
          </Badge>
        ) : null}
      </span>
    ) : (
      <span className="text-muted">{t('billing.noDueDate')}</span>
    ),
  });
  if (invoice.issuedAt) {
    rows.push({ label: t('billing.detail.issued'), value: format.stamp(invoice.issuedAt) });
  }
  rows.push({
    label: t('billing.detail.note'),
    value: invoice.notes ? (
      <span className="whitespace-pre-line">{invoice.notes}</span>
    ) : (
      <span className="text-muted">{t('billing.noNote')}</span>
    ),
  });

  return (
    <SectionCard title={t('billing.detail.title')}>
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-3 text-body">
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 font-semibold break-words text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}

/** A payment towards this invoice: how and when, and what of it went to this invoice. */
export function PaymentRow({
  payment,
  invoiceId,
  onDelete,
}: {
  payment: Payment;
  invoiceId?: string;
  onDelete?: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const towards = invoiceId
    ? payment.allocations.find((a) => a.invoiceId === invoiceId)?.amount
    : undefined;
  const items: MenuItem[] = [
    {
      label: t('billing.receipt'),
      onSelect: () =>
        void openPdf(orgApiPath(membership, `/payments/${payment.id}/receipt`), toast),
    },
  ];
  if (onDelete)
    items.push({ label: t('billing.deletePayment.menu'), onSelect: onDelete, danger: true });
  return (
    <li className="flex items-center gap-3 py-2 pr-2 pl-4">
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-body font-semibold text-text">
          <Method method={payment.method} /> · {format.date(payment.receivedOn)}
        </b>
        {payment.reference ? (
          <small className="truncate text-meta text-muted">
            {t('billing.ref', { ref: payment.reference })}
          </small>
        ) : null}
        {towards && towards.amount !== payment.amount.amount ? (
          <small className="text-meta text-muted">
            {t('billing.payments.partOf', { amount: format.money(payment.amount) })}
          </small>
        ) : null}
      </span>
      <b className="shrink-0 text-body font-semibold text-text tabular-nums">
        {format.money(towards ?? payment.amount)}
      </b>
      <OverflowMenu label={t('billing.paymentActions')} items={items} />
    </li>
  );
}

/** Take off a payment recorded by mistake: what it paid goes back to owing. */
export function DeletePaymentDialog({
  payment,
  onClose,
}: {
  payment: Payment;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const refresh = useRefreshBilling();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={t('billing.deletePayment.title')}
      body={t('billing.deletePayment.body', {
        amount: format.money(payment.amount),
        family: payment.familyName,
      })}
      action={t('billing.deletePayment.action')}
      onConfirm={async () => {
        await api('DELETE', orgApiPath(membership, `/payments/${payment.id}`));
        await refresh();
        toast(t('billing.deletePayment.done'));
      }}
    />
  );
}

/** Only the due date and the note change; the lines are fixed. */
function EditInvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshBilling();
  const toast = useToast();
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? '');
  const [notes, setNotes] = useState(invoice.notes ?? '');

  const save = useMutation({
    mutationFn: () =>
      api<Invoice>('PATCH', orgApiPath(membership, `/invoices/${invoice.id}`), {
        body: {
          updatedAt: invoice.updatedAt,
          dueDate: dueDate || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('billing.edit.saved'));
      onClose();
    },
  });
  const errors = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Dialog open onClose={onClose} title={t('billing.edit.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('billing.edit.due')}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          helper={t('billing.edit.dueHelp')}
          error={errors.dueDate}
        />
        <Field
          label={t('billing.edit.note')}
          helper={t('billing.edit.noteHelp')}
          error={errors.notes}
        >
          {({ className, ...props }) => (
            <textarea
              {...props}
              value={notes}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
              className={cn(className, 'h-auto py-2.5')}
            />
          )}
        </Field>
        <StaleOrError
          error={save.error}
          onReload={() => {
            void refresh();
            onClose();
          }}
        />
        <FormActions onClose={onClose} saving={save.isPending} label={t('billing.edit.save')} />
      </form>
    </Dialog>
  );
}
