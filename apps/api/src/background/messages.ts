export type EmailMessage = {
  orgId: string;
  to: string;
  template: string;
  data: Record<string, unknown>;
  /** messages/message_recipients row to update with delivery status. */
  recipientId?: string;
};

export type JobMessage = {
  orgId: string;
  jobId: string;
};
