import type { PortalInvoice } from '@edustrux/shared';
import { ChevronRight, Download, Landmark, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { PageError } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { invoiceStatus, periodLabel, studentNames } from '../../lib/billing';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { familyBalance, usePortalInvoices } from '../../lib/portal';
import { InvoiceBadge, openPdf } from '../billing/parts';
import { Lines } from '../billing/InvoicePage';
import { SkeletonRows } from '../people/parts';
import { PortalHeading } from './parts';

/**
 * The family's invoices (TUI-126, Figma "Invoices"): what's owed and overdue, each issued
 * invoice with its balance and status, and how to pay. An invoice opens with its lines and PDF.
 * Paying online isn't part of the app.
 */
export function PortalInvoices() {
  const format = useFormat();
  const { org } = useOrg();
  const invoices = usePortalInvoices();
  const [open, setOpen] = useState<PortalInvoice | null>(null);
  const list = invoices.data?.data ?? [];
  const { owing, overdue } = familyBalance(list, format.today);
  const currency = list[0]?.total.currency ?? org?.currency ?? 'NZD';
  // Each family has one reference; a parent of two families sees each.
  const references = [...new Map(list.map((i) => [i.familyId, i])).values()].filter(
    (i) => i.bankReference,
  );

  return (
    <div className="max-w-[880px]">
      <PortalHeading overline={t('portal.invoices.overline')} title={t('nav.invoices')} />

      {invoices.isError ? (
        <PageError error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : (
        <>
          {invoices.isSuccess && list.length ? (
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3.5">
              <span className="text-label text-muted">
                {t('portal.invoices.owing')}{' '}
                <b className="ml-1 text-[17px] font-semibold text-text tabular-nums">
                  {format.money({ amount: owing, currency })}
                </b>
              </span>
              {overdue ? (
                <span className="text-label text-muted">
                  {t('portal.invoices.overdue')}{' '}
                  <b className="ml-1 text-[17px] font-semibold text-danger tabular-nums">
                    {format.money({ amount: overdue, currency })}
                  </b>
                </span>
              ) : null}
            </div>
          ) : null}

          <Card flush className="overflow-hidden">
            {invoices.isPending ? (
              <SkeletonRows rows={3} />
            ) : list.length === 0 ? (
              <p className="flex flex-col items-center px-5 py-10 text-center text-body text-muted">
                <ReceiptText className="mb-2 size-5 text-brand" aria-hidden />
                {t('portal.invoices.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {list.map((invoice) => (
                  <li key={invoice.id}>
                    <InvoiceRow invoice={invoice} onOpen={() => setOpen(invoice)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {references.length ? (
            <Card className="mt-4 flex gap-3 p-4">
              <Landmark className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <h2 className="text-label font-semibold text-text">{t('portal.invoices.howTo')}</h2>
                {references.map((invoice) => (
                  <p key={invoice.familyId} className="mt-1 text-label text-muted">
                    {references.length > 1
                      ? t('portal.invoices.referenceFamily', {
                          family: invoice.familyName,
                          reference: invoice.bankReference ?? '',
                        })
                      : t('portal.invoices.reference', { reference: invoice.bankReference ?? '' })}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}

      {open ? <InvoiceSheet invoice={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** "INV-0042 · October 2026 · Aria, Kavi", its balance and status. */
function InvoiceRow({ invoice, onOpen }: { invoice: PortalInvoice; onOpen: () => void }) {
  const format = useFormat();
  const status = invoiceStatus(invoice, format.today);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid min-h-[72px] w-full grid-cols-[1fr_auto_20px] items-center gap-2.5 px-3.5 py-3 text-left hover:bg-canvas"
    >
      <span className="flex min-w-0 flex-col">
        <b className="text-label font-semibold text-text">{invoice.number}</b>
        <small className="mt-1 truncate text-meta text-muted">
          {[periodLabel(invoice, undefined, format), studentNames(invoice)]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <span className="flex flex-col items-end gap-1.5">
        <strong className="text-label font-semibold text-text tabular-nums">
          {format.money(invoice.balance)}
        </strong>
        <InvoiceBadge status={status} />
      </span>
      <ChevronRight className="size-4 text-subtle" aria-hidden />
    </button>
  );
}

/** One invoice: its dates, lines and totals, and the PDF. */
function InvoiceSheet({ invoice, onClose }: { invoice: PortalInvoice; onClose: () => void }) {
  const format = useFormat();
  const toast = useToast();
  const { membership } = useOrg();
  const [opening, setOpening] = useState(false);
  const status = invoiceStatus(invoice, format.today);
  const dates = [
    invoice.issuedAt ? t('portal.invoices.issued', { date: format.stamp(invoice.issuedAt) }) : null,
    invoice.dueDate ? t('portal.invoices.due', { date: format.date(invoice.dueDate) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={invoice.number ?? t('nav.invoices')}
      subtitle={[periodLabel(invoice, undefined, format), dates].filter(Boolean).join(' · ')}
      actions={
        <Button
          variant="secondary"
          loading={opening}
          icon={<Download className="size-4" />}
          onClick={async () => {
            setOpening(true);
            await openPdf(orgApiPath(membership, `/portal/invoices/${invoice.id}/pdf`), toast);
            setOpening(false);
          }}
        >
          {t('portal.invoices.pdf')}
        </Button>
      }
    >
      <div className="mb-3">
        <InvoiceBadge status={status} />
      </div>
      <Lines invoice={invoice} overdue={status === 'overdue'} />
    </Dialog>
  );
}
