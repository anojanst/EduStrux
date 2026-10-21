export type EmailMessage = {
  orgId: string;
  to: string;
  template: string;
  data: Record<string, unknown>;
  /** messages/message_recipients row to update with delivery status. */
  recipientId?: string;
};

/**
 * An automatic message to send, put on the email queue by the request that caused it so the
 * request doesn't wait for it (template `notice`, TUI-70). The consumer applies the org's
 * notification settings, finds the guardians and writes the message as `messageId`, so a
 * redelivered notice doesn't send twice.
 */
export type Notice = {
  messageId: string;
  /** Who caused it, for the audit row. */
  actorUserId: string | null;
  event: 'session_changed' | 'invoice_issued' | 'invoice_overdue';
  subject: string;
  body: string;
  /** The families to tell, or the students whose families to tell. */
  familyIds?: string[];
  studentIds?: string[];
  audience: { type: string; ids: string[] };
};

export type JobMessage = {
  orgId: string;
  jobId: string;
};
