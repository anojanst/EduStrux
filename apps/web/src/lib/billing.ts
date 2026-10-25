import type { Dashboard, Invoice, InvoiceStatus, Term } from '@edustrux/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../i18n';
import { api } from './api';
import type { useFormat } from './format';
import { orgApiPath, useOrg } from './org';
import { can } from './roles';
import { orgPath } from './session';

type Format = ReturnType<typeof useFormat>;

/** The status to show: an issued or part-paid invoice past its due date is overdue. */
export function invoiceStatus(invoice: Invoice, today: string): InvoiceStatus | 'overdue' {
  if (isOpen(invoice) && invoice.dueDate && invoice.dueDate < today && invoice.balance.amount > 0) {
    return 'overdue';
  }
  return invoice.status;
}

/** Issued or part paid: what a payment can go towards. */
export function isOpen(invoice: Invoice) {
  return invoice.status === 'issued' || invoice.status === 'part_paid';
}

/** "Term 4 2026" for a term run, "November 2026" for a month, else the dates it covers. */
export function periodLabel(
  invoice: Pick<Invoice, 'termId' | 'month' | 'periodStart' | 'periodEnd'>,
  terms: Term[] | undefined,
  format: Format,
) {
  const term = invoice.termId ? terms?.find((x) => x.id === invoice.termId) : undefined;
  if (term) return term.name;
  if (invoice.month) return format.month(invoice.month);
  return t('billing.period.dates', {
    start: format.date(invoice.periodStart),
    end: format.date(invoice.periodEnd),
  });
}

/** "Amaya, Kavi": the first names of the students the invoice bills. */
export function studentNames(invoice: Invoice) {
  const seen = new Map<string, string>();
  for (const line of invoice.lines) seen.set(line.studentId, line.studentFirstName);
  return [...seen.values()].join(', ');
}

/** Oldest first, the order a payment pays invoices off: by due date, then by period. */
export function oldestFirst(invoices: Invoice[]) {
  return [...invoices].sort(
    (a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.periodStart.localeCompare(b.periodStart) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Spreads a payment over the invoices in the order given, each up to its balance. What can't
 * be placed is left over.
 */
export function allocate(amount: number, invoices: Invoice[]) {
  let left = Math.max(0, amount);
  const amounts: Record<string, number> = {};
  for (const invoice of invoices) {
    const part = Math.min(left, invoice.balance.amount);
    amounts[invoice.id] = part;
    left -= part;
  }
  return { amounts, left };
}

/** Where the billing pages live in this org. */
export function useBillingPaths() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return {
    invoices: `${base}/invoices`,
    invoice: (id: string) => `${base}/invoices/${id}`,
    payments: `${base}/payments`,
  };
}

export const invoiceKey = (orgId: string, invoiceId: string) => ['invoice', orgId, invoiceId];

/** After an invoice or a payment changes: every list, page and total that shows it. */
export function useRefreshBilling() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  return () =>
    Promise.all(
      ['invoices', 'invoice', 'payments', 'dashboard', 'open-invoices'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, orgId] }),
      ),
    );
}

/** The money totals of the dashboard, for roles that see money and reports. */
export function useMoneyTotals() {
  const { membership } = useOrg();
  const sees = can(membership.role, 'reports:read') && can(membership.role, 'reports:money');
  const dashboard = useQuery({
    queryKey: ['dashboard', membership.org.id],
    queryFn: ({ signal }) =>
      api<Dashboard>('GET', orgApiPath(membership, '/reports/dashboard'), { signal }),
    enabled: sees,
  });
  return sees ? dashboard.data?.money : undefined;
}
