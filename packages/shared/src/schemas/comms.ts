import { z } from '../zod';
import { PageQuery, Timestamp } from './common';

// Announcements, automatic messages, templates and notification settings (TUI-69, TUI-70).

export const MESSAGE_KINDS = ['announcement', 'automatic'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_CHANNELS = ['email', 'portal'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * Who an announcement goes to: the guardians of the families it reaches.
 * - `all`: every family. `branch`: the families whose home branch is one of `ids`.
 * - `grade`: the families of students in one of these grade levels this academic year.
 * - `subject`, `class`: of students actively enrolled in a class of these subjects, or these
 *   classes. `teacher`: in a class these members teach.
 * - `custom`: these families.
 */
export const AUDIENCE_TYPES = [
  'all',
  'branch',
  'grade',
  'subject',
  'class',
  'teacher',
  'custom',
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

/** Automatic messages, by what they are sent for. */
export const MESSAGE_EVENTS = ['session_changed', 'invoice_issued', 'invoice_overdue'] as const;
export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

/**
 * An email to one guardian: `queued` until the sender takes it, `sent` once the email provider
 * accepted it, then `delivered`, `bounced` or `complained` as it reports back. `failed`: it
 * couldn't be sent. `skipped`: the guardian has no email address.
 */
export const RECIPIENT_EMAIL_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'skipped',
] as const;
export type RecipientEmailStatus = (typeof RECIPIENT_EMAIL_STATUSES)[number];

export const Audience = z
  .object({
    type: z.enum(AUDIENCE_TYPES),
    ids: z.array(z.string()).max(500).default([]).openapi({
      description:
        'The branches, grade levels, subjects, classes, teachers or families. [] for `all`.',
    }),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'all' && a.ids.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Must be empty for all', path: ['ids'] });
    }
    if (a.type !== 'all' && a.ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Required', path: ['ids'] });
    }
  })
  .openapi('Audience');
export type Audience = z.infer<typeof Audience>;

const Subject = z.string().trim().min(1).max(200);
const Body = z.string().trim().min(1).max(10_000);

export const DeliveryCounts = z
  .object(
    Object.fromEntries(RECIPIENT_EMAIL_STATUSES.map((s) => [s, z.number().int()])) as {
      [K in RecipientEmailStatus]: z.ZodNumber;
    },
  )
  .openapi('DeliveryCounts');

export const Message = z
  .object({
    id: z.string().openapi({ example: 'msg_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    kind: z.enum(MESSAGE_KINDS),
    event: z.enum(MESSAGE_EVENTS).nullable().openapi({
      description: 'What an automatic message was sent for. null for an announcement.',
    }),
    subject: z.string(),
    body: z.string(),
    audience: z.object({ type: z.string(), ids: z.array(z.string()) }),
    channels: z.array(z.enum(MESSAGE_CHANNELS)),
    templateId: z.string().nullable(),
    sentByMembershipId: z.string().nullable(),
    recipientCount: z.number().int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Message');
export type Message = z.infer<typeof Message>;

export const MessageRecipient = z
  .object({
    id: z.string(),
    familyId: z.string(),
    guardianId: z.string(),
    email: z.string().nullable(),
    emailStatus: z.enum(RECIPIENT_EMAIL_STATUSES).nullable(),
    error: z.string().nullable(),
    sentAt: Timestamp.nullable(),
    deliveredAt: Timestamp.nullable(),
  })
  .openapi('MessageRecipient');
export type MessageRecipient = z.infer<typeof MessageRecipient>;

export const MessageDetail = Message.extend({
  delivery: DeliveryCounts,
  recipients: z.array(MessageRecipient),
}).openapi('MessageDetail');
export type MessageDetail = z.infer<typeof MessageDetail>;

export const CreateMessage = z
  .object({
    subject: Subject.optional().openapi({ description: 'Required unless a template gives it.' }),
    body: Body.optional().openapi({
      description: 'Plain text. Required unless a template gives it.',
    }),
    templateId: z.string().optional().openapi({
      description: 'Fills in the subject and body that aren’t sent.',
    }),
    audience: Audience,
    channels: z.array(z.enum(MESSAGE_CHANNELS)).min(1).max(2).default(['email', 'portal']),
  })
  .refine((m) => new Set(m.channels).size === m.channels.length, {
    message: 'Each channel once',
    path: ['channels'],
  })
  .openapi('CreateMessage');
export type CreateMessage = z.infer<typeof CreateMessage>;

export const MessageQuery = PageQuery.extend({
  kind: z.enum(MESSAGE_KINDS).optional(),
});

// ── Templates ───────────────────────────────────────────────────────────────

export const MessageTemplate = z
  .object({
    id: z.string().openapi({ example: 'mtp_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    subject: z.string(),
    body: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('MessageTemplate');
export type MessageTemplate = z.infer<typeof MessageTemplate>;

export const CreateMessageTemplate = z
  .object({
    name: z.string().trim().min(1).max(120).openapi({ example: 'Term starts' }),
    subject: Subject,
    body: Body,
  })
  .openapi('CreateMessageTemplate');
export type CreateMessageTemplate = z.infer<typeof CreateMessageTemplate>;

export const UpdateMessageTemplate = CreateMessageTemplate.partial()
  .extend({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
  })
  .openapi('UpdateMessageTemplate');
export type UpdateMessageTemplate = z.infer<typeof UpdateMessageTemplate>;

// ── Notification settings ───────────────────────────────────────────────────

export const NotificationSettings = z
  .object({
    sessionChanges: z.boolean().openapi({
      description: 'Tell families when a lesson is moved or cancelled.',
    }),
    invoiceIssued: z.boolean().openapi({ description: 'Email an invoice when it is issued.' }),
    overdueReminders: z.boolean().openapi({ description: 'Remind families of overdue invoices.' }),
    overdueReminderDays: z
      .array(z.number().int().min(0).max(365))
      .max(5)
      .openapi({
        description:
          'Days after the due date to remind on, each once: `[1, 7, 14]`. 0 is the due date.',
        example: [1, 7, 14],
      }),
    reminderHour: z.number().int().min(0).max(23).openapi({
      description: 'The hour, in the organisation’s timezone, reminders go out at.',
    }),
    replyToEmail: z.string().trim().toLowerCase().max(254).email().nullable().openapi({
      description: 'Where replies to the organisation’s emails go. null = no reply address.',
    }),
    updatedAt: Timestamp.nullable().openapi({ description: 'null while the defaults apply.' }),
  })
  .openapi('NotificationSettings');
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const UpdateNotificationSettings = NotificationSettings.omit({ updatedAt: true })
  .refine((s) => new Set(s.overdueReminderDays).size === s.overdueReminderDays.length, {
    message: 'Each day once',
    path: ['overdueReminderDays'],
  })
  .openapi('UpdateNotificationSettings');
export type UpdateNotificationSettings = z.infer<typeof UpdateNotificationSettings>;

export const DEFAULT_NOTIFICATION_SETTINGS: Omit<NotificationSettings, 'updatedAt'> = {
  sessionChanges: true,
  invoiceIssued: true,
  overdueReminders: true,
  overdueReminderDays: [1, 7, 14],
  reminderHour: 9,
  replyToEmail: null,
};

// ── Parent portal ───────────────────────────────────────────────────────────

export const PortalMessage = z
  .object({
    id: z.string(),
    kind: z.enum(MESSAGE_KINDS),
    event: z.enum(MESSAGE_EVENTS).nullable(),
    subject: z.string(),
    body: z.string(),
    familyIds: z.array(z.string()).openapi({
      description: 'Which of the parent’s families it was sent to.',
    }),
    createdAt: Timestamp,
  })
  .openapi('PortalMessage');
export type PortalMessage = z.infer<typeof PortalMessage>;
