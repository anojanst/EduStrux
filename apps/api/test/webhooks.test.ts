import { memberships, messageRecipients, users } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { signSvix, verifySvix } from '../src/lib/svix';
import { call, db, newOrg, newUser } from './helpers';

// Webhooks from Clerk and Resend (TUI-71): signed the Svix way, and handled once.

let deliveries = 0;

/** Posts a body to a webhook as its sender would, signed with `secret` at `timestamp`. */
async function deliver(
  source: 'clerk' | 'resend',
  payload: unknown,
  {
    id = `msg_${++deliveries}_${crypto.randomUUID()}`,
    secret,
    timestamp,
  }: {
    id?: string;
    secret?: string;
    timestamp?: number;
  } = {},
) {
  const body = JSON.stringify(payload);
  const key =
    secret ?? (source === 'clerk' ? env.CLERK_WEBHOOK_SECRET! : env.RESEND_WEBHOOK_SECRET!);
  const headers = await signSvix(key, id, timestamp ?? Math.floor(Date.now() / 1000), body);
  const res = await exports.default.fetch(
    new Request(`http://api.test/api/v1/webhooks/${source}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const clerkUser = (id: string, email: string, first = 'Mere', last = 'Perera') => ({
  id,
  email_addresses: [
    { id: 'idn_other', email_address: 'old@example.com' },
    { id: 'idn_primary', email_address: email },
  ],
  primary_email_address_id: 'idn_primary',
  first_name: first,
  last_name: last,
});

describe('verifySvix', () => {
  it('takes a right, recent signature and refuses a wrong, stale or missing one', async () => {
    const secret = env.CLERK_WEBHOOK_SECRET!;
    const now = 1_800_000_000;
    const signed = await signSvix(secret, 'msg_1', now, '{"a":1}');
    const headers = (h: Record<string, string>) => new Headers(h);
    expect(await verifySvix(secret, headers(signed), '{"a":1}', now)).toBe('msg_1');
    // Svix sends several signatures while a secret is rotated: any one will do.
    const several = { ...signed, 'svix-signature': `v1,bm9wZQ== ${signed['svix-signature']}` };
    expect(await verifySvix(secret, headers(several), '{"a":1}', now)).toBe('msg_1');
    expect(await verifySvix(secret, headers(signed), '{"a":2}', now)).toBeNull();
    expect(await verifySvix(secret, headers(signed), '{"a":1}', now + 301)).toBeNull();
    expect(
      await verifySvix(env.RESEND_WEBHOOK_SECRET!, headers(signed), '{"a":1}', now),
    ).toBeNull();
    expect(await verifySvix(secret, headers({}), '{"a":1}', now)).toBeNull();
  });
});

describe('POST /webhooks/clerk', () => {
  it('stores a new or changed user’s primary email and name, once per delivery', async () => {
    const clerkId = `user_clerk_${crypto.randomUUID().slice(0, 8)}`;
    const created = await deliver('clerk', {
      type: 'user.created',
      data: clerkUser(clerkId, 'Mere@Example.com'),
    });
    expect(created).toEqual({ status: 200, body: { received: true, duplicate: false } });
    const row = await db().select().from(users).where(eq(users.clerkUserId, clerkId)).get();
    expect(row).toMatchObject({ email: 'mere@example.com', name: 'Mere Perera' });

    const update = {
      type: 'user.updated',
      data: clerkUser(clerkId, 'mere@new.example', 'Mere', 'Ngata'),
    };
    expect((await deliver('clerk', update, { id: 'msg_update_1' })).body.duplicate).toBe(false);
    const again = await deliver('clerk', update, { id: 'msg_update_1' });
    expect(again).toEqual({ status: 200, body: { received: true, duplicate: true } });
    const after = await db().select().from(users).where(eq(users.clerkUserId, clerkId)).get();
    expect(after).toMatchObject({ id: row!.id, email: 'mere@new.example', name: 'Mere Ngata' });

    // Other events are taken and ignored.
    expect((await deliver('clerk', { type: 'session.created', data: {} })).status).toBe(200);
  });

  it('suspends a deleted user’s memberships in every org', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const other = await newUser('owner_b');
    const otherOrg = await newOrg(other.token, 'Harmony Music School');
    const staff = await newUser('staff');
    for (const orgId of [org.id, otherOrg.id]) {
      await db()
        .insert(memberships)
        .values({
          id: newId('membership'),
          orgId,
          userId: staff.userId,
          role: 'front_desk',
          branchIds: null,
        });
    }
    expect(
      (await call('GET', `/api/v1/orgs/${org.id}/branches`, { token: staff.token })).status,
    ).toBe(200);
    const clerkId = (await db().select().from(users).where(eq(users.id, staff.userId)).get())!
      .clerkUserId;
    const res = await deliver('clerk', {
      type: 'user.deleted',
      data: { id: clerkId, deleted: true },
    });
    expect(res.status).toBe(200);
    expect(
      (await call('GET', `/api/v1/orgs/${org.id}/branches`, { token: staff.token })).status,
    ).toBe(404);
    const list = await call('GET', `/api/v1/orgs/${otherOrg.id}/staff`, { token: other.token });
    const member = list.body.data.find((m: { userId: string }) => m.userId === staff.userId);
    expect(member.status).toBe('suspended');
    const audit = (
      await call('GET', `/api/v1/orgs/${org.id}/audit-log?limit=1`, { token: owner.token })
    ).body.data[0];
    expect(audit).toMatchObject({ action: 'membership.updated', actorUserId: null });
  });

  it('refuses a bad or stale signature, and a body that isn’t an event', async () => {
    const data = clerkUser('user_x', 'x@example.com');
    const wrong = await deliver(
      'clerk',
      { type: 'user.created', data },
      {
        secret: env.RESEND_WEBHOOK_SECRET!,
      },
    );
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('unauthenticated');
    const stale = await deliver(
      'clerk',
      { type: 'user.created', data },
      {
        timestamp: Math.floor(Date.now() / 1000) - 600,
      },
    );
    expect(stale.status).toBe(401);
    expect((await deliver('clerk', { nope: true })).status).toBe(400);
    expect((await deliver('clerk', { type: 'user.created', data: { id: 5 } })).status).toBe(400);
  });
});

describe('POST /webhooks/resend', () => {
  it('records delivered, then bounced, on the recipient its tags name', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const base = `/api/v1/orgs/${org.id}`;
    const api = (method: string, path: string, body?: unknown) =>
      call(method, `${base}${path}`, { token: owner.token, body });
    const main = (await api('GET', '/branches')).body.data[0];
    const family = (await api('POST', '/families', { name: 'Perera', branchId: main.id })).body;
    await api('POST', `/families/${family.id}/guardians`, {
      firstName: 'Mere',
      lastName: 'Perera',
      email: 'mere@example.com',
    });
    const sent = await api('POST', '/messages', {
      subject: 'Hello',
      body: 'Term starts Monday.',
      audience: { type: 'all' },
      channels: ['email'],
    });
    expect(sent.status).toBe(201);
    const recipient = await db()
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.messageId, sent.body.id))
      .get();
    // As if Resend took it (tests don't send email).
    await db()
      .update(messageRecipients)
      .set({ emailStatus: 'sent', error: null })
      .where(eq(messageRecipients.id, recipient!.id));
    const status = async () =>
      (await db()
        .select()
        .from(messageRecipients)
        .where(eq(messageRecipients.id, recipient!.id))
        .get())!;
    const tags = { org_id: org.id, recipient_id: recipient!.id };

    const delivered = await deliver('resend', {
      type: 'email.delivered',
      created_at: '2026-10-22T01:00:00.000Z',
      data: { email_id: 'em_1', tags },
    });
    expect(delivered.status).toBe(200);
    expect(await status()).toMatchObject({
      emailStatus: 'delivered',
      deliveredAt: '2026-10-22T01:00:00.000Z',
    });

    await deliver('resend', {
      type: 'email.bounced',
      data: {
        email_id: 'em_1',
        tags: Object.entries(tags).map(([name, value]) => ({ name, value })),
        bounce: { message: 'Mailbox full' },
      },
    });
    expect(await status()).toMatchObject({ emailStatus: 'bounced', error: 'Mailbox full' });

    // A late "delivered" doesn't undo the bounce; another org's id changes nothing.
    await deliver('resend', { type: 'email.delivered', data: { tags } });
    expect((await status()).emailStatus).toBe('bounced');
    const stranger = await newUser('owner_b');
    const strangerOrg = await newOrg(stranger.token, 'Harmony Music School');
    await deliver('resend', {
      type: 'email.complained',
      data: { tags: { org_id: strangerOrg.id, recipient_id: recipient!.id } },
    });
    expect((await status()).emailStatus).toBe('bounced');
    // An email with no tags, such as an invitation, is taken and ignored.
    expect((await deliver('resend', { type: 'email.delivered', data: {} })).status).toBe(200);
  });
});
