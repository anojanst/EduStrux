import { MESSAGE_KINDS, RECIPIENT_EMAIL_STATUSES } from '@edustrux/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { now, orgColumns } from '../columns';

// A message to families: an announcement staff send, or an automatic one the app sends when
// something happens (a lesson moved, an invoice issued or overdue). Each guardian it goes to is a
// recipient row, which holds the email's delivery status and when a parent read it in the portal.
export const messages = sqliteTable(
  'messages',
  {
    ...orgColumns(),
    kind: text('kind', { enum: MESSAGE_KINDS }).notNull(),
    // For an automatic message, what it was sent for: `session_changed`, `invoice_issued`, …
    event: text('event'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    // Who it was addressed to, as asked: `{ type, ids }`.
    audience: text('audience', { mode: 'json' }).$type<{ type: string; ids: string[] }>().notNull(),
    // `email` and/or `portal`.
    channels: text('channels', { mode: 'json' }).$type<string[]>().notNull(),
    templateId: text('template_id'),
    // The member who sent it; null for an automatic message.
    sentByUserId: text('sent_by_user_id'),
    sentByMembershipId: text('sent_by_membership_id'),
    recipientCount: integer('recipient_count').notNull().default(0),
  },
  (t) => [
    // GET /messages pages in id order, newest first (D-101), or a sender's own.
    uniqueIndex('messages_org_id_uq').on(t.orgId, t.id),
    index('messages_org_sender_idx').on(t.orgId, t.sentByMembershipId, t.id),
  ],
);

export const messageRecipients = sqliteTable(
  'message_recipients',
  {
    ...orgColumns(),
    messageId: text('message_id').notNull(),
    familyId: text('family_id').notNull(),
    guardianId: text('guardian_id').notNull(),
    // Copied when the message is sent. null = the guardian has none.
    email: text('email'),
    // null when the message didn't go by email.
    emailStatus: text('email_status', { enum: RECIPIENT_EMAIL_STATUSES }),
    // The email provider's id for the email, from its answer to the send.
    providerId: text('provider_id'),
    error: text('error'),
    sentAt: text('sent_at'),
    deliveredAt: text('delivered_at'),
  },
  (t) => [
    index('message_recipients_org_message_idx').on(t.orgId, t.messageId, t.id),
    // A family's messages, for the parent portal.
    index('message_recipients_org_family_idx').on(t.orgId, t.familyId, t.messageId),
  ],
);

// Text staff reuse for announcements.
export const messageTemplates = sqliteTable(
  'message_templates',
  {
    ...orgColumns(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    uniqueIndex('message_templates_org_id_uq').on(t.orgId, t.id),
    uniqueIndex('message_templates_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// Which automatic messages an org sends. At most one row per org; none means the defaults.
export const notificationSettings = sqliteTable(
  'notification_settings',
  {
    ...orgColumns(),
    sessionChanges: integer('session_changes', { mode: 'boolean' }).notNull().default(true),
    invoiceIssued: integer('invoice_issued', { mode: 'boolean' }).notNull().default(true),
    overdueReminders: integer('overdue_reminders', { mode: 'boolean' }).notNull().default(true),
    // Days after an invoice's due date to remind on, each once.
    overdueReminderDays: text('overdue_reminder_days', { mode: 'json' })
      .$type<number[]>()
      .notNull(),
    // Hour of the day, in the org's timezone, the hourly cron sends reminders at.
    reminderHour: integer('reminder_hour').notNull().default(9),
    replyToEmail: text('reply_to_email'),
  },
  (t) => [
    uniqueIndex('notification_settings_org_uq')
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// Webhook deliveries already handled, so a retried delivery does nothing twice. Not org data.
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    // The sender's own id for the delivery (`svix-id`, Paddle's notification id).
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('webhook_events_source_event_uq').on(t.source, t.eventId)],
);
