import type { PaymentMethod } from '@edustrux/shared';
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  FileText,
  Landmark,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { t } from '../../i18n';
import { ApiError, openDocument } from '../../lib/api';
import { type invoiceStatus, useMoneyTotals } from '../../lib/billing';
import { useFormat } from '../../lib/format';
import { StatCard } from '../classes/parts';
import { errorMessage } from '../../components/PageState';

export function InvoiceBadge({ status }: { status: ReturnType<typeof invoiceStatus> }) {
  const tone = {
    draft: 'neutral',
    issued: 'info',
    part_paid: 'warning',
    paid: 'success',
    void: 'neutral',
    overdue: 'danger',
  } as const;
  return (
    <Badge tone={tone[status]}>
      <span className={status === 'void' ? 'line-through' : undefined}>
        {t(`invoice.status.${status}`)}
      </span>
    </Badge>
  );
}

const METHOD_ICONS = {
  cash: Banknote,
  bank_transfer: Landmark,
  cheque: FileText,
  card: CreditCard,
  other: Wallet,
} as const;

/** The method's icon and name: "Bank transfer". */
export function Method({ method }: { method: PaymentMethod }) {
  const Icon = METHOD_ICONS[method];
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      {t(`people.method.${method}`)}
    </span>
  );
}

/**
 * Owing, overdue, received this month and drafts (ui-design.md §9's money cards), for roles
 * that see money. Two by two on phones.
 */
export function MoneyStats({ draftsTo }: { draftsTo: string }) {
  const money = useMoneyTotals();
  const format = useFormat();
  if (!money) return null;
  // Long amounts step down a size on phones so two cards fit side by side.
  const value = (text: string) => <span className="text-[20px] sm:text-stat">{text}</span>;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        label={t('billing.stat.owing')}
        Icon={CircleDollarSign}
        tone="info"
        value={value(format.money(money.owing))}
      />
      <StatCard
        label={t('billing.stat.overdue')}
        Icon={TriangleAlert}
        tone="danger"
        value={value(format.money(money.overdue))}
        note={
          money.overdueInvoices ? (
            <Badge tone="danger">
              {money.overdueInvoices === 1
                ? t('billing.stat.overdueOne')
                : t('billing.stat.overdueMany', { n: money.overdueInvoices })}
            </Badge>
          ) : (
            t('billing.stat.noneOverdue')
          )
        }
      />
      <StatCard
        label={t('billing.stat.received')}
        Icon={TrendingUp}
        tone="success"
        value={value(format.money(money.receivedThisMonth))}
      />
      <StatCard
        label={t('billing.stat.drafts')}
        Icon={ReceiptText}
        tone="warning"
        value={value(String(money.draftInvoices))}
        note={
          money.draftInvoices ? (
            <Link to={draftsTo} className="font-semibold text-brand hover:underline">
              {t('billing.stat.reviewDrafts')}
            </Link>
          ) : null
        }
      />
    </div>
  );
}

/** Opens an invoice PDF or a receipt; says so when PDFs aren't set up yet (503). */
export async function openPdf(path: string, toast: (message: string) => void) {
  try {
    await openDocument(path);
  } catch (error) {
    toast(
      error instanceof ApiError && error.status === 503
        ? t('billing.pdfUnavailable')
        : errorMessage(error),
    );
  }
}
