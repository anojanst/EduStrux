import type { Invoice, Payment, PaymentMethod } from '@edustrux/shared';
import { PAYMENT_METHODS } from '@edustrux/shared';
import { fromMinorUnits, toMinorUnits } from '@edustrux/shared/money';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, fieldErrors } from '../../lib/api';
import {
  allocate,
  invoiceStatus,
  oldestFirst,
  periodLabel,
  useRefreshBilling,
} from '../../lib/billing';
import { useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { query, type Page } from '../../lib/people';
import { useRefreshPeople, StaleOrError } from '../people/dialogs';
import { InvoiceBadge } from './parts';

/**
 * Record a payment (TUI-119): who paid, how much and how, and which of their issued invoices it
 * pays, filled oldest first. From the invoices and payments pages any family that owes can be
 * chosen; from a family or an invoice, that family.
 */
export function RecordPaymentDialog({
  open,
  onClose,
  familyId,
  familyName,
  invoiceId,
}: {
  open: boolean;
  onClose: () => void;
  familyId?: string;
  familyName?: string;
  /** Opened from an invoice: it is paid first. */
  invoiceId?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={t('billing.pay.title')}
      subtitle={t('billing.pay.subtitle')}
    >
      <PaymentForm
        onClose={onClose}
        familyId={familyId}
        familyName={familyName}
        invoiceId={invoiceId}
      />
    </Dialog>
  );
}

/** Every issued and part-paid invoice the caller reaches (or one family's): what can be paid. */
function useOpenInvoices(familyId: string | undefined) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['open-invoices', membership.org.id, { familyId }],
    queryFn: async ({ signal }) => {
      const all: Invoice[] = [];
      for (const status of ['issued', 'part_paid'] as const) {
        let cursor: string | undefined;
        do {
          const page = await api<Page<Invoice>>(
            'GET',
            orgApiPath(membership, `/invoices${query({ status, familyId, limit: 200, cursor })}`),
            { signal },
          );
          all.push(...page.data);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      return all.filter((i) => i.balance.amount > 0);
    },
  });
}

function PaymentForm({
  onClose,
  familyId: fixedFamily,
  familyName,
  invoiceId,
}: {
  onClose: () => void;
  familyId?: string;
  familyName?: string;
  invoiceId?: string;
}) {
  const { membership, org } = useOrg();
  const format = useFormat();
  const toast = useToast();
  const refreshBilling = useRefreshBilling();
  const refreshPeople = useRefreshPeople();
  const terms = useTerms().data?.data;
  const open = useOpenInvoices(fixedFamily);
  // One key for this form: a retried or double-clicked save records the payment once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [chosenFamily, setChosenFamily] = useState(fixedFamily ?? '');
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [receivedOn, setReceivedOn] = useState(format.today);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [started, setStarted] = useState(false);

  // Families that owe, by name, with what they owe and on how many invoices.
  const families = useMemo(() => {
    const byFamily = new Map<string, { id: string; name: string; invoices: Invoice[] }>();
    for (const invoice of open.data ?? []) {
      const entry = byFamily.get(invoice.familyId) ?? {
        id: invoice.familyId,
        name: invoice.familyName,
        invoices: [],
      };
      entry.invoices.push(invoice);
      byFamily.set(invoice.familyId, entry);
    }
    return [...byFamily.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [open.data]);

  const familyId = chosenFamily || (families.length === 1 ? families[0]!.id : '');
  const family = families.find((f) => f.id === familyId);
  // The invoice the dialog was opened from goes first, then the rest oldest first.
  const invoices = useMemo(() => {
    const list = oldestFirst(family?.invoices ?? []);
    const first = list.findIndex((i) => i.id === invoiceId);
    return first > 0 ? [list[first]!, ...list.slice(0, first), ...list.slice(first + 1)] : list;
  }, [family, invoiceId]);
  const currency = invoices[0]?.balance.currency ?? org?.currency ?? 'NZD';
  const owing = invoices.reduce((sum, i) => sum + i.balance.amount, 0);

  // Opened from an invoice, the amount starts at its balance and is placed on it.
  if (!started && open.data) {
    setStarted(true);
    const from = invoices.find((i) => i.id === invoiceId);
    if (from) spread(fromMinorUnits(from.balance.amount, currency), invoices);
  }

  /** Reads a typed amount as minor units; null when it isn't one. */
  function minor(text: string): number | null {
    if (!text.trim()) return 0;
    try {
      return toMinorUnits(text.replace(/,/g, ''), currency);
    } catch {
      return null;
    }
  }

  /** Places the amount on the invoices in order, each up to its balance. */
  function spread(text: string, list: Invoice[]) {
    setAmountText(text);
    const value = minor(text);
    if (value === null) return;
    const { amounts } = allocate(value, list);
    setApplied(
      Object.fromEntries(
        Object.entries(amounts).map(([id, part]) => [
          id,
          part ? fromMinorUnits(part, currency) : '',
        ]),
      ),
    );
  }

  const amount = minor(amountText);
  const allocated = invoices.reduce((sum, i) => sum + (minor(applied[i.id] ?? '') ?? 0), 0);
  const balanced = amount !== null && amount > 0 && allocated === amount;

  const save = useMutation({
    mutationFn: () =>
      api<Payment>('POST', orgApiPath(membership, '/payments'), {
        idempotencyKey,
        body: {
          familyId,
          method,
          amount: { amount, currency },
          receivedOn,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          allocations: invoices.flatMap((invoice) => {
            const part = minor(applied[invoice.id] ?? '') ?? 0;
            return part > 0 ? [{ invoiceId: invoice.id, amount: { amount: part, currency } }] : [];
          }),
        },
      }),
    onSuccess: async (payment) => {
      await Promise.all([refreshBilling(), refreshPeople()]);
      toast(
        t('billing.pay.done', {
          amount: format.money(payment.amount),
          family: payment.familyName,
        }),
      );
      onClose();
    },
  });
  const apiErrors = fieldErrors(save.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!familyId) local.familyId = t('billing.error.required');
    if (amount === null) local.amount = t('billing.pay.error.amount');
    else if (amount <= 0) local.amount = t('billing.error.required');
    else if (amount > owing) {
      local.amount = t('billing.pay.error.tooMuch', {
        family: family?.name ?? '',
        amount: format.money({ amount: owing, currency }),
      });
    }
    if (receivedOn > format.today) local.receivedOn = t('billing.pay.error.future');
    for (const invoice of invoices) {
      const part = minor(applied[invoice.id] ?? '');
      if (part === null) local[invoice.id] = t('billing.pay.error.amount');
      else if (part > invoice.balance.amount) {
        local[invoice.id] = t('billing.pay.error.overBalance', {
          amount: format.money(invoice.balance),
        });
      }
    }
    if (!local.amount && amount && !balanced) local.allocations = t('billing.pay.error.allocate');
    setErrors(local);
    if (Object.keys(local).length === 0) save.mutate();
  }

  if (open.isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-canvas" aria-hidden />;
  }
  if (open.isError) {
    return <StaleOrError error={open.error} onReload={() => void open.refetch()} />;
  }
  if (families.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <Notice tone="info">
          {fixedFamily
            ? t('billing.pay.nothingFamily', { family: familyName ?? '' })
            : t('billing.pay.nothing')}
        </Notice>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    );
  }

  const error = (key: string) => errors[key] ?? apiErrors[key];
  const left = (amount ?? 0) - allocated;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {fixedFamily ? null : (
        <SelectField
          label={t('billing.pay.family')}
          required
          value={familyId}
          onChange={(e) => {
            const next = families.find((f) => f.id === e.target.value);
            setChosenFamily(e.target.value);
            spread(amountText, oldestFirst(next?.invoices ?? []));
          }}
          error={error('familyId')}
          options={[
            ...(families.length > 1 ? [{ value: '', label: t('billing.pay.chooseFamily') }] : []),
            ...families.map((f) => ({
              value: f.id,
              label: t(f.invoices.length === 1 ? 'billing.pay.owesOne' : 'billing.pay.owesMany', {
                family: f.name,
                amount: format.money({
                  amount: f.invoices.reduce((sum, i) => sum + i.balance.amount, 0),
                  currency: f.invoices[0]!.balance.currency,
                }),
                n: f.invoices.length,
              }),
            })),
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t('billing.pay.amount')}
          required
          error={error('amount') ?? error('amount.amount')}
        >
          {({ className, ...props }) => (
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border-strong bg-canvas px-3 text-label font-semibold text-muted">
                {currency}
              </span>
              <input
                {...props}
                inputMode="decimal"
                value={amountText}
                placeholder="0.00"
                onChange={(e) => spread(e.target.value, invoices)}
                className={cn(className, 'rounded-l-none tabular-nums')}
              />
            </div>
          )}
        </Field>
        <TextField
          label={t('billing.pay.receivedOn')}
          type="date"
          required
          max={format.today}
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
          error={error('receivedOn')}
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-label font-medium text-text">
          {t('billing.pay.method')}
        </legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-strong p-1 sm:grid-cols-5">
          {PAYMENT_METHODS.map((value) => (
            <label
              key={value}
              className={cn(
                'flex h-10 cursor-pointer items-center justify-center rounded-md px-2 text-center text-label leading-tight has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand sm:h-9',
                method === value
                  ? 'bg-brand-soft font-semibold text-brand'
                  : 'text-secondary-text hover:bg-canvas',
              )}
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="sr-only"
              />
              {t(`people.method.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('billing.pay.reference')}
          value={reference}
          maxLength={100}
          onChange={(e) => setReference(e.target.value)}
          helper={t('billing.pay.referenceHelp')}
          error={error('reference')}
        />
        <TextField
          label={t('billing.pay.notes')}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          error={error('notes')}
        />
      </div>

      {family ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <p className="border-b border-border px-4 py-3 text-section font-medium">
            {t('billing.pay.towards')}
          </p>
          <div
            aria-hidden
            className="grid grid-cols-[1fr_96px_112px] gap-3 border-b border-border bg-[#fafbfb] px-4 py-2 text-meta font-semibold text-muted max-sm:hidden"
          >
            <span>{t('billing.pay.col.invoice')}</span>
            <span className="text-right">{t('billing.col.balance')}</span>
            <span className="text-right">{t('billing.pay.col.apply')}</span>
          </div>
          <ul className="divide-y divide-border">
            {invoices.map((invoice) => {
              const name = [invoice.number, periodLabel(invoice, terms, format)]
                .filter(Boolean)
                .join(' · ');
              const shown = invoiceStatus(invoice, format.today);
              return (
                <li
                  key={invoice.id}
                  className="grid grid-cols-[1fr_112px] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_96px_112px]"
                >
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-body font-semibold text-text">{name}</b>
                    <span className="flex flex-wrap items-center gap-2 text-meta text-muted">
                      {invoice.dueDate
                        ? t('people.due', { date: format.date(invoice.dueDate) })
                        : t('people.noDueDate')}
                      {shown === 'overdue' ? <InvoiceBadge status="overdue" /> : null}
                      <span className="sm:hidden">
                        · {t('billing.pay.owes', { amount: format.money(invoice.balance) })}
                      </span>
                    </span>
                    {error(invoice.id) ? (
                      <small className="text-meta text-danger">{error(invoice.id)}</small>
                    ) : null}
                  </span>
                  <span className="text-right text-body tabular-nums max-sm:hidden">
                    {format.money(invoice.balance)}
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label={t('billing.pay.applyTo', { invoice: name })}
                    aria-invalid={error(invoice.id) ? true : undefined}
                    value={applied[invoice.id] ?? ''}
                    placeholder="0.00"
                    onChange={(e) => setApplied((a) => ({ ...a, [invoice.id]: e.target.value }))}
                    className={cn(
                      'h-11 w-full rounded-lg border bg-surface px-3 text-right text-body tabular-nums focus:outline-2 focus:outline-brand sm:h-10',
                      error(invoice.id) ? 'border-danger' : 'border-border-strong',
                    )}
                  />
                </li>
              );
            })}
          </ul>
          <p
            role="status"
            className={cn(
              'border-t border-border px-4 py-3 text-meta font-semibold',
              !amount ? 'text-muted' : balanced ? 'text-success' : 'text-warning',
            )}
          >
            {t('billing.pay.allocated', {
              allocated: format.money({ amount: allocated, currency }),
              amount: format.money({ amount: Math.max(0, amount ?? 0), currency }),
            })}
            {amount && !balanced && left > 0
              ? ` · ${t('billing.pay.left', { amount: format.money({ amount: left, currency }) })}`
              : ''}
          </p>
        </div>
      ) : null}
      {error('allocations') ? (
        <p className="text-meta text-danger">{error('allocations')}</p>
      ) : null}

      <StaleOrError error={save.error} onReload={() => void open.refetch()} />
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {t('billing.recordPayment')}
        </Button>
      </div>
    </form>
  );
}
