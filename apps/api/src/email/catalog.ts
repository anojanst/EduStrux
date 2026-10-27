// The server's English catalog: the text of system emails and automatic messages (D-015). Keyed
// by id, the same shape as the web app's catalog, so adding a language is translation work.
// `{name}` is filled in by `t()`. Organisation-authored text (announcements) is never in here.

export const en = {
  'email.footer': 'Sent by {orgName}.',
  'email.invitation.subject': 'You’re invited to join {orgName}',
  'email.invitation.body':
    '{orgName} has invited you to join them as {role}.\n\nYour invitation code is {token}. It ' +
    'works until {expiresOn}.',
  'email.invitation.link': 'Accept the invitation: {link}',
  'role.owner': 'an owner',
  'role.branch_manager': 'a branch manager',
  'role.front_desk': 'front desk staff',
  'role.teacher': 'a teacher',
  'role.parent': 'a parent',
  'role.accountant': 'an accountant',
  'session.moved.subject': '{className}: lesson moved to {date}',
  'session.moved.body':
    'The {className} lesson on {oldDate} at {oldTime} has moved to {date} at {time}.',
  'session.retimed.subject': '{className}: new time on {date}',
  'session.retimed.body': 'The {className} lesson on {date} now starts at {time} (was {oldTime}).',
  'session.cancelled.subject': '{className}: lesson on {date} cancelled',
  'session.cancelled.body': 'The {className} lesson on {date} at {time} is cancelled.',
  'session.restored.subject': '{className}: lesson on {date} is back on',
  'session.restored.body': 'The {className} lesson on {date} at {time} is going ahead after all.',
  'session.note': '\n\n{note}',
  'invoice.issued.subject': 'Invoice {number} from {orgName}: {total}',
  'invoice.issued.body':
    'Invoice {number} for {familyName} is ready: {total}.{due}\n\nPlease quote your reference ' +
    '{bankReference} when you pay by bank transfer.',
  'invoice.issued.due': ' It is due on {dueDate}.',
  'invoice.overdue.subject': 'Reminder: {balance} overdue',
  'invoice.overdue.body':
    'Invoice {number} for {familyName} was due on {dueDate}, and {balance} is still owing.\n\nPlease ' +
    'quote your reference {bankReference} when you pay by bank transfer. If you have already ' +
    'paid, thank you, and please ignore this reminder.',
  'pdf.invoice.title': 'Invoice',
  'pdf.invoice.draft': 'Draft: not yet issued',
  'pdf.invoice.void': 'Void',
  'pdf.invoice.billTo': 'Bill to',
  'pdf.invoice.reference': 'Reference',
  'pdf.invoice.number': 'Invoice number',
  'pdf.invoice.period': 'Period',
  'pdf.invoice.issued': 'Issued',
  'pdf.invoice.due': 'Due',
  'pdf.invoice.taxNumber': 'Tax number',
  'pdf.invoice.student': 'Student',
  'pdf.invoice.class': 'Class',
  'pdf.invoice.lessons': 'Lessons',
  'pdf.invoice.price': 'Price',
  'pdf.invoice.discount': 'Discount',
  'pdf.invoice.amount': 'Amount',
  'pdf.invoice.subtotal': 'Subtotal',
  'pdf.invoice.tax': 'Tax',
  'pdf.invoice.taxLine': '{name} {rate}%',
  'pdf.invoice.taxIncluded': 'included',
  'pdf.invoice.total': 'Total',
  'pdf.invoice.paid': 'Paid',
  'pdf.invoice.balance': 'Balance due',
  'pdf.invoice.payBy': 'Please quote {bankReference} when paying by bank transfer.',
  'pdf.basis.per_term': 'per term',
  'pdf.basis.per_month': 'per month',
  'pdf.basis.per_lesson': 'per lesson',
  'pdf.basis.pack': 'per pack of {lessons}',
  'pdf.receipt.title': 'Receipt',
  'pdf.receipt.received': 'Received from',
  'pdf.receipt.date': 'Date',
  'pdf.receipt.method': 'Method',
  'pdf.receipt.amount': 'Amount received',
  'pdf.receipt.towards': 'Paid towards',
  'pdf.receipt.invoice': 'Invoice {reference}',
  'pdf.receipt.thanks': 'Thank you.',
  'payment.cash': 'Cash',
  'payment.bank_transfer': 'Bank transfer',
  'payment.cheque': 'Cheque',
  'payment.card': 'Card',
  'payment.other': 'Other',
} as const;

export type CatalogKey = keyof typeof en;

/** The catalog's text for `key`, with each `{name}` replaced by `vars.name`. */
export function t(key: CatalogKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
