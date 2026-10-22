import type { Invoice, InvoiceStatus } from '@edustrux/shared';

/** The status to show: an issued or part-paid invoice past its due date is overdue. */
export function invoiceStatus(invoice: Invoice, today: string): InvoiceStatus | 'overdue' {
  const open = invoice.status === 'issued' || invoice.status === 'part_paid';
  if (open && invoice.dueDate && invoice.dueDate < today && invoice.balance.amount > 0) {
    return 'overdue';
  }
  return invoice.status;
}
