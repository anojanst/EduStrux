import type { Db } from '@edustrux/db';
import { z } from '@hono/zod-openapi';
import type { Bindings } from '../../env';
import { unauthenticated, unavailable, validationFailed } from '../../lib/errors';
import * as paddle from '../../lib/paddle';
import { verifySvix } from '../../lib/svix';
import * as comms from '../comms/service';
import * as staff from '../staff/service';
import * as subscriptions from '../subscriptions/service';
import * as users from '../users/repository';
import * as repo from './repository';

// Webhooks from Clerk and Resend (TUI-71), and Paddle (TUI-73). Both sign the Svix way. A delivery is checked, handled
// and then recorded by its `svix-id`, so one sent again is answered without being handled twice;
// two at once may both be handled, which is harmless as each step is idempotent.

export type WebhookAnswer = { received: true; duplicate: boolean };

type Headers = { get(name: string): string | null };

async function verified(
  db: Db,
  source: repo.WebhookSource,
  secret: string | undefined,
  headers: Headers,
  body: string,
) {
  if (!secret) throw unavailable(`The ${source} webhook isn't set up.`);
  const id = await verifySvix(secret, headers, body);
  if (!id) throw unauthenticated('Bad or stale webhook signature');
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    throw validationFailed({ body: ['Not JSON'] });
  }
  return { id, event, duplicate: await repo.seen(db, source, id) };
}

// ── Clerk ───────────────────────────────────────────────────────────────────

const ClerkUser = z.object({
  id: z.string(),
  email_addresses: z.array(z.object({ id: z.string(), email_address: z.string() })).default([]),
  primary_email_address_id: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
});
const ClerkEvent = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });

/**
 * Keeps `users` in step with Clerk: a created or updated user's primary email and name are
 * stored, and a deleted user's memberships are suspended in every org. Other events are ignored.
 */
export async function clerkWebhook(
  db: Db,
  env: Bindings,
  headers: Headers,
  body: string,
): Promise<WebhookAnswer> {
  const { id, event, duplicate } = await verified(
    db,
    'clerk',
    env.CLERK_WEBHOOK_SECRET,
    headers,
    body,
  );
  if (duplicate) return { received: true, duplicate };
  const parsed = ClerkEvent.safeParse(event);
  if (!parsed.success) throw validationFailed({ body: ['Not a Clerk event'] });
  const { type, data } = parsed.data;

  if (type === 'user.created' || type === 'user.updated') {
    const user = ClerkUser.safeParse(data);
    if (!user.success) throw validationFailed({ data: ['Not a Clerk user'] });
    const u = user.data;
    const primary =
      u.email_addresses.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses[0];
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    await users.syncFromClerk(db, {
      clerkUserId: u.id,
      email: primary?.email_address.toLowerCase() ?? null,
      name: name || null,
    });
  } else if (type === 'user.deleted' && typeof data.id === 'string') {
    const userId = await users.userIdOf(db, data.id);
    if (userId) await staff.suspendEverywhere(db, userId);
  }
  await repo.record(db, 'clerk', id, type);
  return { received: true, duplicate: false };
}

// ── Resend ──────────────────────────────────────────────────────────────────

const ResendEvent = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z
    .object({
      // Resend sends tags as an object; older payloads as a list of { name, value }.
      tags: z
        .union([
          z.record(z.string(), z.string()),
          z.array(z.object({ name: z.string(), value: z.string() })),
        ])
        .optional(),
      bounce: z.object({ message: z.string().optional() }).passthrough().optional(),
      failed: z.object({ reason: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
});

const OUTCOMES = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
} as const;

/**
 * What happened to a message's email after Resend took it: delivered, bounced, complained or
 * failed, on the recipient its `org_id` and `recipient_id` tags name. Emails without them (such
 * as invitations) and other events are ignored.
 */
export async function resendWebhook(
  db: Db,
  env: Bindings,
  headers: Headers,
  body: string,
): Promise<WebhookAnswer> {
  const { id, event, duplicate } = await verified(
    db,
    'resend',
    env.RESEND_WEBHOOK_SECRET,
    headers,
    body,
  );
  if (duplicate) return { received: true, duplicate };
  const parsed = ResendEvent.safeParse(event);
  if (!parsed.success) throw validationFailed({ body: ['Not a Resend event'] });
  const { type, data } = parsed.data;
  const status = OUTCOMES[type as keyof typeof OUTCOMES];
  const tags = Array.isArray(data.tags)
    ? Object.fromEntries(data.tags.map((tag) => [tag.name, tag.value]))
    : (data.tags ?? {});
  if (status && tags.org_id && tags.recipient_id) {
    await comms.recordDelivery({ db, orgId: tags.org_id, actorUserId: null }, tags.recipient_id, {
      status,
      at: parsed.data.created_at ?? new Date().toISOString(),
      error: data.bounce?.message ?? data.failed?.reason,
    });
  }
  await repo.record(db, 'resend', id, type);
  return { received: true, duplicate: false };
}

// ── Paddle ──────────────────────────────────────────────────────────────────

const PaddleEvent = z.object({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Keeps the org's subscription, plan and status in step with Paddle (TUI-73): every
 * `subscription.*` event carries the whole subscription, which is stored. Paddle signs with its
 * own scheme (`Paddle-Signature: ts=…;h1=…`) and names each delivery by `event_id`.
 */
export async function paddleWebhook(
  db: Db,
  env: Bindings,
  headers: Headers,
  body: string,
): Promise<WebhookAnswer> {
  if (!env.PADDLE_WEBHOOK_SECRET) throw unavailable('The paddle webhook isn’t set up.');
  if (
    !(await paddle.verifyPaddle(env.PADDLE_WEBHOOK_SECRET, headers.get('paddle-signature'), body))
  ) {
    throw unauthenticated('Bad or stale webhook signature');
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw validationFailed({ body: ['Not JSON'] });
  }
  const parsed = PaddleEvent.safeParse(json);
  if (!parsed.success) throw validationFailed({ body: ['Not a Paddle event'] });
  const event = parsed.data;
  if (await repo.seen(db, 'paddle', event.event_id)) return { received: true, duplicate: true };

  if (event.event_type.startsWith('subscription.')) {
    const subscription = subscriptions.PaddleSubscription.safeParse(event.data);
    if (!subscription.success) throw validationFailed({ data: ['Not a Paddle subscription'] });
    const outcome = await subscriptions.applyPaddleSubscription(
      db,
      env,
      subscription.data,
      event.occurred_at,
    );
    if (outcome === 'no_org') {
      console.warn(`paddle ${event.event_id}: subscription ${subscription.data.id} has no org`);
    }
  }
  await repo.record(db, 'paddle', event.event_id, event.event_type);
  return { received: true, duplicate: false };
}

/** Forgets deliveries older than 30 days, for the daily cron: senders retry for less. */
export function forgetOldDeliveries(db: Db, now: Date) {
  return repo.forget(db, new Date(now.getTime() - 30 * 86_400_000).toISOString());
}
