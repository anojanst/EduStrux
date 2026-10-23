import {
  formatDate,
  formatMoney,
  themeColours,
  utcToLocal,
  type Invoice,
  type Org,
  type Payment,
} from '@edustrux/shared';
import { t, type CatalogKey } from '../email/catalog';

// The printable pages behind invoice and receipt PDFs (TUI-59): English catalog text (D-015),
// numbers, money and dates with the shared helpers in the org's locale and date format. Nothing
// org-authored is trusted as HTML.

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** An invoice's short reference on paper: the end of its id, in capitals. */
export const invoiceReference = (invoiceId: string) => invoiceId.slice(-8).toUpperCase();

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans', 'Noto Sans Tamil', system-ui, sans-serif; color: #1f2933; font-size: 12px; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; color: var(--brand); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .org { font-size: 16px; font-weight: 600; }
  .muted { color: #616e7c; }
  .banner { border: 2px solid #c81e1e; color: #c81e1e; padding: 6px 10px; font-weight: 600; display: inline-block; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { text-align: left; border-bottom: 2px solid #cbd2d9; padding: 6px 4px; font-weight: 600; }
  td { border-bottom: 1px solid #e4e7eb; padding: 6px 4px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals { width: 50%; margin-left: auto; }
  .totals td { border: none; padding: 3px 4px; }
  .totals .strong td { font-weight: 700; border-top: 2px solid #cbd2d9; }
  .meta td { border: none; padding: 2px 8px 2px 0; }
`;

function page(org: Org, title: string, body: string) {
  const { brand } = themeColours(org.theme);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>:root { --brand: ${brand}; }${STYLE}</style></head>
<body>${body}</body></html>`;
}

function header(org: Org, title: string, meta: [string, string][]) {
  const rows = meta
    .map(([k, v]) => `<tr><td class="muted">${escape(k)}</td><td>${escape(v)}</td></tr>`)
    .join('');
  return `<div class="head">
  <div><div class="org">${escape(org.name)}</div>${
    org.taxNumber
      ? `<div class="muted">${escape(t('pdf.invoice.taxNumber'))}: ${escape(org.taxNumber)}</div>`
      : ''
  }</div>
  <div><h1>${escape(title)}</h1><table class="meta">${rows}</table></div>
</div>`;
}

/** An invoice as a printable page. */
export function invoiceHtml(org: Org, invoice: Invoice): string {
  const money = (m: { amount: number; currency: string }) => formatMoney(m, org.locale);
  const date = (d: string) => formatDate(d, org.dateFormat);
  const meta: [string, string][] = [
    [t('pdf.invoice.reference'), invoiceReference(invoice.id)],
    [t('pdf.invoice.period'), `${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`],
  ];
  if (invoice.issuedAt) {
    meta.push([t('pdf.invoice.issued'), date(utcToLocal(invoice.issuedAt, org.timezone).date)]);
  }
  if (invoice.dueDate) meta.push([t('pdf.invoice.due'), date(invoice.dueDate)]);
  const banner =
    invoice.status === 'draft'
      ? t('pdf.invoice.draft')
      : invoice.status === 'void'
        ? t('pdf.invoice.void')
        : null;
  const basis = (line: Invoice['lines'][number]) =>
    t(`pdf.basis.${line.basis}` as CatalogKey, {
      lessons: line.lessons / Math.max(1, line.quantity),
    });
  const lines = invoice.lines
    .map(
      (line) => `<tr>
  <td>${escape(`${line.studentFirstName} ${line.studentLastName}`)}</td>
  <td>${escape(line.className)}</td>
  <td class="num">${line.lessons}${line.periodLessons !== null ? ` / ${line.periodLessons}` : ''}</td>
  <td class="num">${escape(money(line.unitPrice))} <span class="muted">${escape(basis(line))}</span></td>
  <td class="num">${line.discount.amount > 0 ? `−${escape(money(line.discount))}` : ''}</td>
  <td class="num">${escape(money(line.subtotal))}</td>
</tr>`,
    )
    .join('\n');
  const taxes = new Map<string, number>();
  for (const line of invoice.lines) {
    if (line.taxName === null || line.taxRateBps === null) continue;
    const label =
      t('pdf.invoice.taxLine', { name: line.taxName, rate: line.taxRateBps / 100 }) +
      (line.taxInclusive ? ` (${t('pdf.invoice.taxIncluded')})` : '');
    taxes.set(label, (taxes.get(label) ?? 0) + line.tax.amount);
  }
  const currency = invoice.total.currency;
  const taxRows = [...taxes]
    .map(
      ([label, amount]) =>
        `<tr><td>${escape(label)}</td><td class="num">${escape(money({ amount, currency }))}</td></tr>`,
    )
    .join('');
  const body = `${banner ? `<div class="banner">${escape(banner)}</div>` : ''}
${header(org, t('pdf.invoice.title'), meta)}
<div><span class="muted">${escape(t('pdf.invoice.billTo'))}</span><br><strong>${escape(invoice.familyName)}</strong></div>
<table>
<thead><tr><th>${escape(t('pdf.invoice.student'))}</th><th>${escape(t('pdf.invoice.class'))}</th><th class="num">${escape(t('pdf.invoice.lessons'))}</th><th class="num">${escape(t('pdf.invoice.price'))}</th><th class="num">${escape(t('pdf.invoice.discount'))}</th><th class="num">${escape(t('pdf.invoice.amount'))}</th></tr></thead>
<tbody>${lines}</tbody>
</table>
<table class="totals">
<tr><td>${escape(t('pdf.invoice.subtotal'))}</td><td class="num">${escape(money(invoice.subtotal))}</td></tr>
${taxRows}
<tr class="strong"><td>${escape(t('pdf.invoice.total'))}</td><td class="num">${escape(money(invoice.total))}</td></tr>
<tr><td>${escape(t('pdf.invoice.paid'))}</td><td class="num">${escape(money(invoice.paid))}</td></tr>
<tr class="strong"><td>${escape(t('pdf.invoice.balance'))}</td><td class="num">${escape(money(invoice.balance))}</td></tr>
</table>
${invoice.bankReference ? `<p>${escape(t('pdf.invoice.payBy', { bankReference: invoice.bankReference }))}</p>` : ''}
${invoice.notes ? `<p>${escape(invoice.notes).replaceAll('\n', '<br>')}</p>` : ''}`;
  return page(org, `${t('pdf.invoice.title')} ${invoiceReference(invoice.id)}`, body);
}

/** A payment's receipt as a printable page. */
export function receiptHtml(org: Org, payment: Payment): string {
  const money = (m: { amount: number; currency: string }) => formatMoney(m, org.locale);
  const meta: [string, string][] = [
    [t('pdf.invoice.reference'), invoiceReference(payment.id)],
    [t('pdf.receipt.date'), formatDate(payment.receivedOn, org.dateFormat)],
    [t('pdf.receipt.method'), t(`payment.${payment.method}` as CatalogKey)],
  ];
  const towards = payment.allocations
    .map(
      (a) =>
        `<tr><td>${escape(t('pdf.receipt.invoice', { reference: invoiceReference(a.invoiceId) }))}</td><td class="num">${escape(money(a.amount))}</td></tr>`,
    )
    .join('');
  const body = `${header(org, t('pdf.receipt.title'), meta)}
<div><span class="muted">${escape(t('pdf.receipt.received'))}</span><br><strong>${escape(payment.familyName)}</strong></div>
<table class="totals">
<tr class="strong"><td>${escape(t('pdf.receipt.amount'))}</td><td class="num">${escape(money(payment.amount))}</td></tr>
</table>
<h3>${escape(t('pdf.receipt.towards'))}</h3>
<table>${towards}</table>
${payment.reference ? `<p class="muted">${escape(payment.reference)}</p>` : ''}
<p>${escape(t('pdf.receipt.thanks'))}</p>`;
  return page(org, `${t('pdf.receipt.title')} ${invoiceReference(payment.id)}`, body);
}
