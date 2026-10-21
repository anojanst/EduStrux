import {
  DEFAULT_NOTIFICATION_SETTINGS,
  RECIPIENT_EMAIL_STATUSES,
  newId,
  type Audience,
  type CreateMessage,
  type CreateMessageTemplate,
  type Message,
  type MessageChannel,
  type MessageDetail,
  type MessageEvent,
  type MessageTemplate,
  type NotificationSettings,
  type PortalMessage,
  type UpdateMessageTemplate,
  type UpdateNotificationSettings,
} from '@edustrux/shared';
import type { EmailMessage, Notice } from '../../background/messages';
import type { Access, Ids, OrgCtx } from '../../db/scope';
import { conflict, forbidden, notFound, staleData, unprocessable } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as classes from '../classes/service';
import * as curriculum from '../curriculum/service';
import * as enrolment from '../enrolment/service';
import * as people from '../people/service';
import * as repo from './repository';

// Announcements staff send, the automatic messages the app sends, message templates and the
// org's notification settings (TUI-69, TUI-70). A message goes to the guardians of the families
// it reaches: by email to each one with an address, and in the parent portal.

/** At most this many emails go to the queue in one call. */
const QUEUE_BATCH = 100;

export function toMessage(row: repo.MessageRow): Message {
  return {
    id: row.id,
    kind: row.kind,
    event: (row.event as MessageEvent | null) ?? null,
    subject: row.subject,
    body: row.body,
    audience: row.audience,
    channels: row.channels as MessageChannel[],
    templateId: row.templateId,
    sentByMembershipId: row.sentByMembershipId,
    recipientCount: row.recipientCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecipient(row: repo.RecipientRow) {
  return {
    id: row.id,
    familyId: row.familyId,
    guardianId: row.guardianId,
    email: row.email,
    emailStatus: row.emailStatus,
    error: row.error,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
  };
}

/**
 * Whose messages a caller reads: the owner every message, anyone else the ones they sent. A
 * parent reads theirs in the portal.
 */
function sentByFilter(access: Access) {
  if (access.role === 'parent') throw forbidden();
  return access.scope === 'all' ? undefined : access.membershipId;
}

export async function listMessages(
  ctx: OrgCtx,
  access: Access,
  limit: number,
  cursor: string | undefined,
  filter: { kind?: string },
) {
  const sentBy = sentByFilter(access);
  const rows = await repo.listMessages(ctx, limit, decodeCursor(cursor), {
    ...filter,
    sentByMembershipId: sentBy,
  });
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toMessage), nextCursor };
}

/** One stage: the message and its recipients are read together. */
export async function getMessage(ctx: OrgCtx, access: Access, id: string): Promise<MessageDetail> {
  const sentBy = sentByFilter(access);
  const [row, recipients] = await Promise.all([
    repo.findMessage(ctx, id, sentBy),
    repo.listRecipients(ctx, repo.messageFound(ctx, id, sentBy)),
  ]);
  if (!row) throw notFound('Message');
  const delivery = Object.fromEntries(
    RECIPIENT_EMAIL_STATUSES.map((s) => [s, 0]),
  ) as MessageDetail['delivery'];
  for (const r of recipients) if (r.emailStatus) delivery[r.emailStatus] += 1;
  return { ...toMessage(row), delivery, recipients: recipients.map(toRecipient) };
}

/** The families an audience names, as ids to filter the guardians by. */
async function audienceFamilies(ctx: OrgCtx, audience: Audience): Promise<Ids> {
  const ofStudents = people.familiesOfStudentIds;
  switch (audience.type) {
    case 'all':
      return people.allFamilies(ctx);
    case 'branch':
      return people.familiesInBranches(ctx, audience.ids);
    case 'grade':
      return ofStudents(ctx, await people.studentsInGrades(ctx, audience.ids));
    case 'subject':
      return ofStudents(
        ctx,
        enrolment.studentsEnrolledIn(
          ctx,
          classes.classesOfCourses(ctx, curriculum.coursesOfSubjects(ctx, audience.ids)),
        ),
      );
    case 'class':
      return ofStudents(ctx, enrolment.studentsEnrolledIn(ctx, audience.ids));
    case 'teacher':
      return ofStudents(
        ctx,
        enrolment.studentsEnrolledIn(ctx, classes.classesTaughtByAny(ctx, audience.ids)),
      );
    case 'custom':
      return audience.ids;
  }
}

type Guardian = { id: string; familyId: string; email: string | null };

/** A recipient row for each guardian. Without email, or with no address, nothing is emailed. */
function recipientRows(
  ctx: OrgCtx,
  messageId: string,
  guardians: Guardian[],
  channels: string[],
): (repo.NewRecipientRow & { id: string })[] {
  const byEmail = channels.includes('email');
  return guardians.map((g) => ({
    id: newId('messageRecipient'),
    orgId: ctx.orgId,
    messageId,
    familyId: g.familyId,
    guardianId: g.id,
    email: g.email,
    emailStatus: byEmail ? (g.email ? 'queued' : 'skipped') : null,
  }));
}

/**
 * Puts the message's emails on the queue. A queue that fails leaves those recipients `queued`;
 * the message itself is already stored, and the portal shows it.
 */
async function queueEmails(
  ctx: OrgCtx,
  queue: Queue<EmailMessage>,
  recipients: { id: string; email?: string | null; emailStatus?: string | null }[],
) {
  const toSend = recipients.filter((r) => r.emailStatus === 'queued' && r.email);
  for (let i = 0; i < toSend.length; i += QUEUE_BATCH) {
    const batch = toSend.slice(i, i + QUEUE_BATCH).map((r) => ({
      body: {
        orgId: ctx.orgId,
        to: r.email!,
        template: 'message',
        data: {},
        recipientId: r.id,
      } satisfies EmailMessage,
    }));
    try {
      await queue.sendBatch(batch);
    } catch (err) {
      console.error(`org ${ctx.orgId}: ${batch.length} email(s) not queued`, err);
    }
  }
}

/**
 * Sends an announcement to the guardians of the families its audience names, as far as the
 * caller reaches: branch staff their branches' families, a teacher their students' families. A
 * template fills in what isn't sent. One read stage, the write, then the emails are queued.
 */
export async function sendMessage(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<EmailMessage>,
  input: CreateMessage,
): Promise<Message> {
  const { audience } = input;
  const families = await audienceFamilies(ctx, audience);
  const [template, guardians, named] = await Promise.all([
    input.templateId ? repo.findTemplate(ctx, input.templateId) : undefined,
    people.guardiansToMessage(ctx, access, families),
    audience.type === 'custom' ? people.familiesReached(ctx, access, audience.ids) : undefined,
  ]);
  if (input.templateId && !template) throw notFound('Message template');
  if (named && named.length < new Set(audience.ids).size) throw notFound('Family');
  const subject = input.subject ?? template?.subject;
  const body = input.body ?? template?.body;
  if (!subject || !body) {
    throw unprocessable('A message needs a subject and a body, or a template that has them.', {
      ...(subject ? {} : { subject: ['Required'] }),
      ...(body ? {} : { body: ['Required'] }),
    });
  }
  if (guardians.length === 0) {
    throw unprocessable('Nobody you can reach is in this audience.', { audience: ['No one'] });
  }

  const id = newId('message');
  const recipients = recipientRows(ctx, id, guardians, input.channels);
  const stored = await repo.insertMessage(
    ctx,
    {
      id,
      orgId: ctx.orgId,
      kind: 'announcement',
      event: null,
      subject,
      body,
      audience: { type: audience.type, ids: audience.ids },
      channels: input.channels,
      templateId: input.templateId ?? null,
      sentByUserId: ctx.actorUserId,
      sentByMembershipId: access.membershipId,
      recipientCount: recipients.length,
    },
    recipients,
  );
  await queueEmails(ctx, queue, recipients);
  return toMessage(stored);
}

/**
 * Puts an automatic message on the email queue, so the request that caused it doesn't wait for it
 * (TUI-70). Returns the id the message gets once sent: none is sent when the org's settings turn
 * the event off or nobody is there to tell. A queue that fails is logged, and the change that
 * caused it stands.
 */
export async function queueNotice(
  ctx: OrgCtx,
  queue: Queue<EmailMessage>,
  notice: Omit<Notice, 'messageId' | 'actorUserId'>,
): Promise<string | null> {
  const messageId = newId('message');
  try {
    await queue.send({
      orgId: ctx.orgId,
      to: '',
      template: 'notice',
      data: { ...notice, messageId, actorUserId: ctx.actorUserId } satisfies Notice,
    });
    return messageId;
  } catch (err) {
    console.error(`org ${ctx.orgId}: ${notice.event} notice not queued`, err);
    return null;
  }
}

/**
 * Sends a queued automatic message: to the guardians of its families, when the org's settings
 * send its event. It is stored like an announcement, so the portal shows it and its emails are
 * tracked. A redelivered notice finds its message already there and does nothing.
 */
export async function sendNotice(ctx: OrgCtx, queue: Queue<EmailMessage>, notice: Notice) {
  const familyIds = notice.familyIds ?? people.familiesOfStudentIds(ctx, notice.studentIds ?? []);
  const [settings, guardians, already] = await Promise.all([
    getSettings(ctx),
    people.guardiansOfFamilies(ctx, familyIds),
    repo.findMessage(ctx, notice.messageId),
  ]);
  if (already || !eventOn(settings, notice.event) || guardians.length === 0) return;
  const channels: MessageChannel[] = ['email', 'portal'];
  const recipients = recipientRows(ctx, notice.messageId, guardians, channels);
  await repo.insertMessage(
    { ...ctx, actorUserId: notice.actorUserId },
    {
      id: notice.messageId,
      orgId: ctx.orgId,
      kind: 'automatic',
      event: notice.event,
      subject: notice.subject,
      body: notice.body,
      audience: notice.audience,
      channels,
      templateId: null,
      sentByUserId: null,
      sentByMembershipId: null,
      recipientCount: recipients.length,
    },
    recipients,
  );
  await queueEmails(ctx, queue, recipients);
}

function eventOn(settings: NotificationSettings, event: MessageEvent) {
  switch (event) {
    case 'session_changed':
      return settings.sessionChanges;
    case 'invoice_issued':
      return settings.invoiceIssued;
    case 'invoice_overdue':
      return settings.overdueReminders;
  }
}

// ── Parent portal ───────────────────────────────────────────────────────────

/**
 * The messages sent to a parent's families through the portal, newest first. One stage: the page
 * and which of the families each went to are read together.
 */
export async function messagesForParent(
  ctx: OrgCtx,
  parentMembershipId: string,
  limit: number,
  cursor: string | undefined,
) {
  const familyIds = people.familiesOfGuardian(ctx, parentMembershipId);
  const beforeId = decodeCursor(cursor);
  const rows = await repo.messagesToFamilies(ctx, familyIds, limit, beforeId);
  const { data, nextCursor } = toPage(rows, limit);
  const pairs =
    data.length > 0
      ? await repo.familiesOfMessages(
          ctx,
          data.map((m) => m.id),
          familyIds,
        )
      : [];
  return {
    data: data.map((row): PortalMessage => ({
      id: row.id,
      kind: row.kind,
      event: (row.event as MessageEvent | null) ?? null,
      subject: row.subject,
      body: row.body,
      familyIds: pairs.filter((p) => p.messageId === row.id).map((p) => p.familyId),
      createdAt: row.createdAt,
    })),
    nextCursor,
  };
}

// ── Templates ───────────────────────────────────────────────────────────────

function toTemplate(row: repo.TemplateRow): MessageTemplate {
  const { orgId: _org, deletedAt: _deleted, ...template } = row;
  return template;
}

export async function listTemplates(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listTemplates(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toTemplate), nextCursor };
}

const templateNameTaken = () => conflict('A template with that name exists', { name: ['Taken'] });

export async function createTemplate(
  ctx: OrgCtx,
  input: CreateMessageTemplate,
): Promise<MessageTemplate> {
  if (await repo.templateNameTaken(ctx, input.name)) throw templateNameTaken();
  const row = await repo.insertTemplate(ctx, {
    id: newId('messageTemplate'),
    orgId: ctx.orgId,
    ...input,
  });
  return toTemplate(row);
}

export async function updateTemplate(
  ctx: OrgCtx,
  id: string,
  input: UpdateMessageTemplate,
): Promise<MessageTemplate> {
  const { updatedAt, ...changes } = input;
  const [before, taken] = await Promise.all([
    repo.findTemplate(ctx, id),
    changes.name ? repo.templateNameTaken(ctx, changes.name, id) : false,
  ]);
  if (!before) throw notFound('Message template');
  if (before.updatedAt !== updatedAt) throw staleData();
  if (Object.keys(changes).length === 0) return toTemplate(before);
  if (taken) throw templateNameTaken();
  const updated = await repo.updateTemplate(ctx, before, changes);
  if (!updated) throw notFound('Message template');
  return toTemplate(updated);
}

export async function deleteTemplate(ctx: OrgCtx, id: string) {
  const before = await repo.findTemplate(ctx, id);
  if (!before) throw notFound('Message template');
  await repo.softDeleteTemplate(ctx, before);
}

// ── Notification settings ───────────────────────────────────────────────────

function toSettings(row: repo.SettingsRow | undefined): NotificationSettings {
  if (!row) return { ...DEFAULT_NOTIFICATION_SETTINGS, updatedAt: null };
  return {
    sessionChanges: row.sessionChanges,
    invoiceIssued: row.invoiceIssued,
    overdueReminders: row.overdueReminders,
    overdueReminderDays: row.overdueReminderDays,
    reminderHour: row.reminderHour,
    replyToEmail: row.replyToEmail,
    updatedAt: row.updatedAt,
  };
}

/** The org's settings, or the defaults while it has saved none. */
export async function getSettings(ctx: OrgCtx): Promise<NotificationSettings> {
  return toSettings(await repo.findSettings(ctx));
}

/** Saves all the settings: the later save wins, as for a class's schedule. */
export async function saveSettings(
  ctx: OrgCtx,
  input: UpdateNotificationSettings,
): Promise<NotificationSettings> {
  const before = await repo.findSettings(ctx);
  const values = {
    ...input,
    overdueReminderDays: [...input.overdueReminderDays].sort((a, b) => a - b),
  };
  return toSettings(await repo.saveSettings(ctx, before, values, newId('notificationSettings')));
}

/** The settings of these orgs, by org id, for the hourly cron. Defaults for an org with none. */
export async function settingsOf(db: OrgCtx['db'], orgIds: string[]) {
  const rows = await repo.settingsOfOrgs(db, orgIds);
  const byOrg = new Map(rows.map((row) => [row.orgId, toSettings(row)]));
  return (orgId: string) => byOrg.get(orgId) ?? toSettings(undefined);
}

// ── What the email sender asks ──────────────────────────────────────────────

/** A recipient with its message, for sending its email. */
export function findRecipient(ctx: OrgCtx, id: string) {
  return repo.findRecipient(ctx, id);
}

export function setEmailStatus(...args: Parameters<typeof repo.setEmailStatus>) {
  return repo.setEmailStatus(...args);
}
