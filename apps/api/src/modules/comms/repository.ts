import {
  messageRecipients,
  messageTemplates,
  messages,
  notificationSettings,
  now,
} from '@edustrux/db';
import type { RecipientEmailStatus } from '@edustrux/shared';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  changedFields,
  idsFrom,
  inIds,
  inOrg,
  writeWithAudit,
  type IdQuery,
  type Ids,
  type OrgCtx,
} from '../../db/scope';

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type RecipientRow = typeof messageRecipients.$inferSelect;
export type NewRecipientRow = typeof messageRecipients.$inferInsert;
export type TemplateRow = typeof messageTemplates.$inferSelect;
export type NewTemplateRow = typeof messageTemplates.$inferInsert;
export type SettingsRow = typeof notificationSettings.$inferSelect;
export type NewSettingsRow = typeof notificationSettings.$inferInsert;

// D1 binds at most 100 values per statement. A recipient row binds 12.
const RECIPIENTS_PER_INSERT = 8;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ── Messages ────────────────────────────────────────────────────────────────

export type MessageFilter = { kind?: string; sentByMembershipId?: string };

/** Newest first. Fetches `limit + 1` rows so the caller can tell if there's another page. */
export function listMessages(
  ctx: OrgCtx,
  limit: number,
  beforeId: string | undefined,
  filter: MessageFilter,
) {
  return ctx.db
    .select()
    .from(messages)
    .where(
      inOrg(
        ctx,
        messages,
        filter.sentByMembershipId
          ? eq(messages.sentByMembershipId, filter.sentByMembershipId)
          : undefined,
        filter.kind ? eq(messages.kind, filter.kind as MessageRow['kind']) : undefined,
        beforeId ? lt(messages.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit + 1);
}

/** One message, if it was sent by this member, or by anyone when `sentBy` is undefined. */
export function findMessage(ctx: OrgCtx, id: string, sentBy?: string) {
  return ctx.db
    .select()
    .from(messages)
    .where(
      inOrg(
        ctx,
        messages,
        eq(messages.id, id),
        sentBy ? eq(messages.sentByMembershipId, sentBy) : undefined,
      ),
    )
    .get();
}

/** The message `findMessage` finds, as an id: its recipients are read by it in the same stage. */
export function messageFound(ctx: OrgCtx, id: string, sentBy?: string): IdQuery {
  return idsFrom(
    ctx,
    messages,
    messages.id,
    eq(messages.id, id),
    sentBy ? eq(messages.sentByMembershipId, sentBy) : undefined,
  );
}

/** The recipients of these messages, oldest first. */
export function listRecipients(ctx: OrgCtx, messageIds: Ids) {
  return ctx.db
    .select()
    .from(messageRecipients)
    .where(inOrg(ctx, messageRecipients, inIds(messageRecipients.messageId, messageIds)))
    .orderBy(asc(messageRecipients.messageId), asc(messageRecipients.id));
}

/**
 * Writes the message and its recipients as one batch with one audit row. An automatic message
 * has no actor, so its row says which event sent it.
 */
export async function insertMessage(
  ctx: OrgCtx,
  message: NewMessageRow & { id: string },
  recipients: (NewRecipientRow & { id: string })[],
  other: BatchItem<'sqlite'>[] = [],
): Promise<MessageRow> {
  const [, inserted] = await writeWithAudit(
    ctx,
    [
      ctx.db.insert(messages).values(message).returning(),
      ...chunks(recipients, RECIPIENTS_PER_INSERT).map((rows) =>
        ctx.db.insert(messageRecipients).values(rows),
      ),
      ...other,
    ],
    {
      action: 'message.sent',
      entityType: 'message',
      entityId: message.id,
      after: {
        kind: message.kind,
        event: message.event ?? null,
        subject: message.subject,
        audience: message.audience,
        channels: message.channels,
        recipients: recipients.length,
      },
    },
  );
  const stored = (inserted as MessageRow[])[0];
  if (!stored) throw new Error('Message missing after insert');
  return stored;
}

/**
 * Statements for the caller's batch that write an automatic message and its recipients, with no
 * audit row of their own: the change that sends it has one.
 */
export function messageStatements(
  ctx: OrgCtx,
  message: NewMessageRow & { id: string },
  recipients: (NewRecipientRow & { id: string })[],
): BatchItem<'sqlite'>[] {
  return [
    ctx.db.insert(messages).values(message),
    ...chunks(recipients, RECIPIENTS_PER_INSERT).map((rows) =>
      ctx.db.insert(messageRecipients).values(rows),
    ),
  ];
}

/** One recipient, for the email sender: the message's subject and body come with it. */
export function findRecipient(ctx: OrgCtx, id: string) {
  return ctx.db
    .select({ recipient: messageRecipients, message: messages })
    .from(messageRecipients)
    .innerJoin(messages, eq(messages.id, messageRecipients.messageId))
    .where(and(inOrg(ctx, messageRecipients, eq(messageRecipients.id, id)), inOrg(ctx, messages)))
    .get();
}

/**
 * Sets an email's status. `onlyFrom` keeps a late or repeated report from moving it backwards:
 * a delivery report doesn't undo a bounce, and a retried send doesn't send twice.
 */
export async function setEmailStatus(
  ctx: OrgCtx,
  id: string,
  change: Partial<
    Pick<RecipientRow, 'emailStatus' | 'providerId' | 'error' | 'sentAt' | 'deliveredAt'>
  >,
  onlyFrom?: RecipientEmailStatus[],
) {
  const rows = await ctx.db
    .update(messageRecipients)
    .set(change)
    .where(
      inOrg(
        ctx,
        messageRecipients,
        eq(messageRecipients.id, id),
        onlyFrom ? inArray(messageRecipients.emailStatus, onlyFrom) : undefined,
      ),
    )
    .returning({ id: messageRecipients.id });
  return rows.length > 0;
}

/** The messages sent to these families, newest first, for the parent portal. */
export function messagesToFamilies(
  ctx: OrgCtx,
  familyIds: Ids,
  limit: number,
  beforeId: string | undefined,
) {
  const toFamilies = idsFrom(
    ctx,
    messageRecipients,
    messageRecipients.messageId,
    inIds(messageRecipients.familyId, familyIds),
  );
  return ctx.db
    .select()
    .from(messages)
    .where(
      inOrg(
        ctx,
        messages,
        inIds(messages.id, toFamilies),
        sql`${messages.channels} like '%portal%'`,
        beforeId ? lt(messages.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit + 1);
}

/** Which of these families each of these messages went to. */
export function familiesOfMessages(ctx: OrgCtx, messageIds: Ids, familyIds: Ids) {
  return ctx.db
    .selectDistinct({
      messageId: messageRecipients.messageId,
      familyId: messageRecipients.familyId,
    })
    .from(messageRecipients)
    .where(
      inOrg(
        ctx,
        messageRecipients,
        inIds(messageRecipients.messageId, messageIds),
        inIds(messageRecipients.familyId, familyIds),
      ),
    );
}

// ── Templates ───────────────────────────────────────────────────────────────

export function listTemplates(ctx: OrgCtx, limit: number, afterId?: string) {
  return ctx.db
    .select()
    .from(messageTemplates)
    .where(
      inOrg(ctx, messageTemplates, afterId ? sql`${messageTemplates.id} > ${afterId}` : undefined),
    )
    .orderBy(asc(messageTemplates.id))
    .limit(limit + 1);
}

export function findTemplate(ctx: OrgCtx, id: string) {
  return ctx.db
    .select()
    .from(messageTemplates)
    .where(inOrg(ctx, messageTemplates, eq(messageTemplates.id, id)))
    .get();
}

export async function templateNameTaken(ctx: OrgCtx, name: string, exceptId?: string) {
  const row = await ctx.db
    .select({ n: count() })
    .from(messageTemplates)
    .where(
      inOrg(
        ctx,
        messageTemplates,
        sql`lower(${messageTemplates.name}) = lower(${name})`,
        exceptId ? sql`${messageTemplates.id} <> ${exceptId}` : undefined,
      ),
    )
    .get();
  return (row?.n ?? 0) > 0;
}

export async function insertTemplate(ctx: OrgCtx, row: NewTemplateRow & { id: string }) {
  const [, inserted] = await writeWithAudit(
    ctx,
    [ctx.db.insert(messageTemplates).values(row).returning()],
    {
      action: 'message_template.created',
      entityType: 'message_template',
      entityId: row.id,
      after: row,
    },
  );
  return (inserted as TemplateRow[])[0]!;
}

export async function updateTemplate(
  ctx: OrgCtx,
  before: TemplateRow,
  changes: Partial<Pick<TemplateRow, 'name' | 'subject' | 'body'>>,
) {
  const [, updated] = await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(messageTemplates)
        .set(changes)
        .where(inOrg(ctx, messageTemplates, eq(messageTemplates.id, before.id)))
        .returning(),
    ],
    {
      action: 'message_template.updated',
      entityType: 'message_template',
      entityId: before.id,
      ...changedFields(before, changes),
    },
  );
  return (updated as TemplateRow[])[0];
}

export async function softDeleteTemplate(ctx: OrgCtx, before: TemplateRow) {
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .update(messageTemplates)
        .set({ deletedAt: now() })
        .where(inOrg(ctx, messageTemplates, eq(messageTemplates.id, before.id))),
    ],
    {
      action: 'message_template.deleted',
      entityType: 'message_template',
      entityId: before.id,
      before,
    },
  );
}

// ── Notification settings ───────────────────────────────────────────────────

export function findSettings(ctx: OrgCtx) {
  return ctx.db.select().from(notificationSettings).where(inOrg(ctx, notificationSettings)).get();
}

/** Writes the org's settings, adding its row the first time. Returns them as stored. */
export async function saveSettings(
  ctx: OrgCtx,
  before: SettingsRow | undefined,
  values: Omit<NewSettingsRow, 'id' | 'orgId'>,
  newId: string,
) {
  const statement = before
    ? ctx.db
        .update(notificationSettings)
        .set({ ...values, updatedAt: now() })
        .where(inOrg(ctx, notificationSettings, eq(notificationSettings.id, before.id)))
        .returning()
    : ctx.db
        .insert(notificationSettings)
        .values({ id: newId, orgId: ctx.orgId, ...values })
        .returning();
  const [, saved] = await writeWithAudit(ctx, [statement], {
    action: 'notification_settings.updated',
    entityType: 'notification_settings',
    entityId: before?.id ?? newId,
    ...(before ? changedFields(before, values) : { after: values }),
  });
  return (saved as SettingsRow[])[0]!;
}

/** Every org's settings with any of these ids, for the hourly cron. */
export function settingsOfOrgs(db: OrgCtx['db'], orgIds: string[]) {
  return db
    .select()
    .from(notificationSettings)
    .where(
      and(
        sql`${notificationSettings.orgId} in (select value from json_each(${JSON.stringify(orgIds)}))`,
        sql`${notificationSettings.deletedAt} is null`,
      ),
    );
}

/** Clears the email addresses copied onto these guardians' messages (TUI-79). */
export function eraseStatements(ctx: OrgCtx, guardianIds: string[]): BatchItem<'sqlite'>[] {
  if (guardianIds.length === 0) return [];
  return [
    ctx.db
      .update(messageRecipients)
      .set({ email: null })
      .where(
        and(
          eq(messageRecipients.orgId, ctx.orgId),
          inIds(messageRecipients.guardianId, guardianIds),
        ),
      ),
  ];
}

/** Deletes the family's message recipient rows for good (TUI-118). The messages stay. */
export function purgeStatements(ctx: OrgCtx, familyId: string): BatchItem<'sqlite'>[] {
  return [
    ctx.db
      .delete(messageRecipients)
      .where(and(eq(messageRecipients.orgId, ctx.orgId), eq(messageRecipients.familyId, familyId))),
  ];
}
