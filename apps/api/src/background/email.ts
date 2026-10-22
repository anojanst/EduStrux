import { formatDate, utcToLocal, type Role } from '@edustrux/shared';
import type { Db } from '@edustrux/db';
import type { OrgCtx } from '../db/scope';
import { t } from '../email/catalog';
import { renderEmail, type RenderedEmail } from '../email/render';
import type { Bindings } from '../env';
import * as comms from '../modules/comms/service';
import * as orgs from '../modules/orgs/service';
import type { EmailMessage, Notice } from './messages';

/** Must match `max_retries` for the email consumer in wrangler.jsonc. */
export const EMAIL_MAX_RETRIES = 5;

const RESEND_URL = 'https://api.resend.com/emails';

/** Why an email wasn't sent, when trying again can't help. */
class Undeliverable extends Error {}

/** Sends one email through Resend. Returns Resend's id for it. */
async function send(
  env: Bindings,
  email: RenderedEmail & { to: string; replyTo?: string | null },
  tags: Record<string, string>,
  idempotencyKey: string,
  fetchFn: typeof fetch,
): Promise<string> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Undeliverable('Email sending is not set up (RESEND_API_KEY and EMAIL_FROM)');
  }
  const res = await fetchFn(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // Resend sends a request with the same key once, so a retried try doesn't send twice.
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      tags: Object.entries(tags).map(([name, value]) => ({ name, value })),
    }),
  });
  if (res.ok) {
    const body = (await res.json()) as { id?: string };
    return body.id ?? '';
  }
  const detail = (await res.text()).slice(0, 500);
  // Too many requests, or Resend's own trouble: worth another try. Anything else isn't.
  if (res.status === 429 || res.status >= 500) throw new Error(`Resend ${res.status}: ${detail}`);
  throw new Undeliverable(`Resend ${res.status}: ${detail}`);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One delivery of an email from the queue: render it, send it, and record what happened on the
 * message's recipient. `attempt` is the queue's delivery count, from 1. A `notice` is an
 * automatic message still to write: writing it queues its emails.
 *
 * A recipient is sent to once: one no longer `queued` is left alone, so a redelivered message
 * does nothing. A try that can be repeated throws, for the queue to retry with backoff, until the
 * last, which marks the email failed.
 */
export async function deliverEmail(
  db: Db,
  env: Bindings,
  message: EmailMessage,
  attempt: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const ctx: OrgCtx = { db, orgId: message.orgId, actorUserId: null };
  const lastTry = attempt > EMAIL_MAX_RETRIES;

  if (message.template === 'notice') {
    // Writes the message and queues its emails; a failure is retried like a send.
    await comms.sendNotice(ctx, env.EMAIL_QUEUE, message.data as Notice);
    return;
  }

  if (message.template === 'message') {
    if (!message.recipientId) return;
    const [found, org, settings] = await Promise.all([
      comms.findRecipient(ctx, message.recipientId),
      orgs.getOrg(ctx),
      comms.getSettings(ctx),
    ]);
    if (!found || found.recipient.emailStatus !== 'queued' || !found.recipient.email) return;
    const email = renderEmail({
      orgName: org.name,
      subject: found.message.subject,
      body: found.message.body,
    });
    try {
      const providerId = await send(
        env,
        { ...email, to: found.recipient.email, replyTo: settings.replyToEmail },
        { org_id: ctx.orgId, recipient_id: found.recipient.id },
        found.recipient.id,
        fetchFn,
      );
      await comms.setEmailStatus(
        ctx,
        found.recipient.id,
        { emailStatus: 'sent', providerId, sentAt: new Date().toISOString(), error: null },
        ['queued'],
      );
    } catch (err) {
      if (err instanceof Undeliverable || lastTry) {
        await comms.setEmailStatus(
          ctx,
          found.recipient.id,
          { emailStatus: 'failed', error: errorText(err) },
          ['queued'],
        );
        return;
      }
      throw err;
    }
    return;
  }

  if (message.template === 'invitation') {
    const data = message.data as { token: string; role: Role; orgName: string; expiresAt: string };
    const org = await orgs.getOrg(ctx);
    const link = env.APP_URL
      ? `\n\n${t('email.invitation.link', { link: `${env.APP_URL.replace(/\/$/, '')}/invitations/${data.token}` })}`
      : '';
    const email = renderEmail({
      orgName: data.orgName,
      subject: t('email.invitation.subject', { orgName: data.orgName }),
      body:
        t('email.invitation.body', {
          orgName: data.orgName,
          role: t(`role.${data.role}`),
          token: data.token,
          expiresOn: formatDate(utcToLocal(data.expiresAt, org.timezone).date, org.dateFormat),
        }) + link,
    });
    try {
      await send(
        env,
        { ...email, to: message.to },
        { org_id: ctx.orgId },
        data.token.slice(0, 32),
        fetchFn,
      );
    } catch (err) {
      if (err instanceof Undeliverable || lastTry) {
        console.error(`org ${ctx.orgId}: invitation email to ${message.to} not sent`, err);
        return;
      }
      throw err;
    }
    return;
  }

  console.warn(`Unknown email template "${message.template}"`);
}
