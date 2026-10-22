import { enrolments, memberships, orgs } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/errors';
import { createCheckout, createPortalSession, signPaddle, verifyPaddle } from '../src/lib/paddle';
import { call, db, newOrg, newUser } from './helpers';

// The org's subscription through Paddle (TUI-73), and what its plan allows (TUI-74).

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const member = async (role: Role) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: user.userId,
        role,
        branchIds: null,
      });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  const setOrg = (changes: Partial<typeof orgs.$inferInsert>) =>
    db().update(orgs).set(changes).where(eq(orgs.id, org.id));
  return { org, base, api, make, member, setOrg };
}

let events = 0;

/** A Paddle `subscription.*` event for the org, as Paddle sends it. */
function subscriptionEvent(
  orgId: string,
  overrides: {
    type?: string;
    id?: string;
    status?: string;
    priceId?: string;
    occurredAt?: string;
    eventId?: string;
    scheduledCancel?: string;
  } = {},
) {
  return {
    event_id: overrides.eventId ?? `evt_${++events}_${crypto.randomUUID()}`,
    event_type: overrides.type ?? 'subscription.created',
    occurred_at: overrides.occurredAt ?? new Date().toISOString(),
    data: {
      id: overrides.id ?? `sub_${orgId}`,
      status: overrides.status ?? 'active',
      customer_id: 'ctm_1',
      items: [
        {
          price: {
            id: overrides.priceId ?? 'pri_solo_month',
            billing_cycle: { interval: 'month' },
          },
        },
      ],
      custom_data: { org_id: orgId },
      current_billing_period: {
        starts_at: '2026-10-01T00:00:00Z',
        ends_at: '2026-11-01T00:00:00Z',
      },
      scheduled_change: overrides.scheduledCancel
        ? { action: 'cancel', effective_at: overrides.scheduledCancel }
        : null,
    },
  };
}

async function paddleDeliver(payload: unknown, secret = env.PADDLE_WEBHOOK_SECRET!) {
  const body = JSON.stringify(payload);
  const res = await exports.default.fetch(
    new Request('http://api.test/api/v1/webhooks/paddle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paddle-Signature': await signPaddle(secret, Math.floor(Date.now() / 1000), body),
      },
      body,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('GET /billing/subscription', () => {
  it('shows a new org on its trial, with the Small plan’s room, and is owner only', async () => {
    const { api, member } = await setup();
    const res = await api('GET', '/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plan: 'trial',
      status: 'trialing',
      trialEndsAt: expect.any(String),
      canWrite: true,
      studentLimit: 150,
      activeStudents: 0,
      subscription: null,
    });
    for (const role of [
      'branch_manager',
      'front_desk',
      'accountant',
      'teacher',
      'parent',
    ] as const) {
      expect((await (await member(role)).as('GET', '/billing/subscription')).status).toBe(403);
    }
  });
});

describe('the Paddle webhook', () => {
  it('records a new subscription and sets the org’s plan, once per event', async () => {
    const { org, api } = await setup();
    const event = subscriptionEvent(org.id);
    expect(await paddleDeliver(event)).toEqual({
      status: 200,
      body: { received: true, duplicate: false },
    });
    expect((await paddleDeliver(event)).body.duplicate).toBe(true);
    const overview = (await api('GET', '/billing/subscription')).body;
    expect(overview).toMatchObject({
      plan: 'solo',
      status: 'active',
      canWrite: true,
      studentLimit: 30,
      subscription: {
        plan: 'solo',
        interval: 'month',
        status: 'active',
        currentPeriodEnd: '2026-11-01T00:00:00Z',
        cancelAt: null,
      },
    });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({ action: 'subscription.created', actorUserId: null });

    // Upgraded to Small yearly, and the owner asks to cancel at the period's end.
    await paddleDeliver(
      subscriptionEvent(org.id, {
        type: 'subscription.updated',
        priceId: 'pri_small_year',
        scheduledCancel: '2027-10-01T00:00:00Z',
      }),
    );
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'small',
      subscription: { plan: 'small', cancelAt: '2027-10-01T00:00:00Z' },
    });

    // An older event arriving late changes nothing.
    await paddleDeliver(
      subscriptionEvent(org.id, {
        type: 'subscription.updated',
        status: 'past_due',
        occurredAt: '2020-01-01T00:00:00Z',
      }),
    );
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'small',
      status: 'active',
    });
  });

  it('makes a cancelled org read-only, but it can still read, export and subscribe', async () => {
    const { org, api, make } = await setup();
    await paddleDeliver(subscriptionEvent(org.id));
    await paddleDeliver(
      subscriptionEvent(org.id, { type: 'subscription.canceled', status: 'canceled' }),
    );
    const overview = (await api('GET', '/billing/subscription')).body;
    expect(overview).toMatchObject({ status: 'cancelled', canWrite: false });

    const write = await api('POST', '/subjects', { name: 'Science' });
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe('subscription_required');
    expect((await api('GET', '/subjects')).status).toBe(200);
    expect((await api('POST', '/exports')).status).toBe(202);
    // A cancelled subscription isn't live, so a new checkout may start (503 here: no API key).
    const again = await api('POST', '/billing/checkout', { plan: 'small', interval: 'year' });
    expect(again.status).toBe(503);

    // Subscribing again: a new subscription becomes the org's.
    await paddleDeliver(subscriptionEvent(org.id, { id: `sub_new_${org.id}` }));
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      status: 'active',
      canWrite: true,
    });
    // A late event for the old one leaves the org alone.
    await paddleDeliver(
      subscriptionEvent(org.id, { type: 'subscription.updated', status: 'canceled' }),
    );
    expect((await api('GET', '/billing/subscription')).body.status).toBe('active');
    expect((await make('/subjects', { name: 'Science' })).id).toMatch(/^sbj_/);
  });

  it('refuses a bad signature, and ignores a subscription with no org', async () => {
    const { org } = await setup();
    expect((await paddleDeliver(subscriptionEvent(org.id), 'wrong-secret')).status).toBe(401);
    const orphan = subscriptionEvent('org_missing', { id: 'sub_orphan' });
    expect((await paddleDeliver(orphan)).status).toBe(200);
    expect((await paddleDeliver({ event_id: 'evt_x' })).status).toBe(400);
  });
});

describe('POST /billing/checkout and /billing/portal', () => {
  it('refuse a second subscription, and need one for the portal', async () => {
    const { org, api } = await setup();
    expect((await api('POST', '/billing/portal')).status).toBe(422);
    expect((await api('POST', '/billing/checkout', { plan: 'solo' })).status).toBe(503);
    expect((await api('POST', '/billing/checkout', { plan: 'gold' })).status).toBe(400);
    await paddleDeliver(subscriptionEvent(org.id));
    const second = await api('POST', '/billing/checkout', { plan: 'small' });
    expect(second.status).toBe(422);
    expect(second.body.error.fields).toEqual({ plan: ['Already subscribed'] });
    expect((await api('POST', '/billing/portal')).status).toBe(503);
  });

  it('call Paddle’s API with the org’s id and the subscription', async () => {
    const configured = { ...env, PADDLE_API_KEY: 'pdl_key' };
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'txn_1', checkout: { url: 'https://pay/x' } } })),
    );
    const out = await createCheckout(
      configured,
      { priceId: 'pri_solo_month', orgId: 'org_1', customerId: 'ctm_1' },
      fetchFn as unknown as typeof fetch,
    );
    expect(out).toEqual({ transactionId: 'txn_1', checkoutUrl: 'https://pay/x' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox-api.paddle.com/transactions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pdl_key');
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ price_id: 'pri_solo_month', quantity: 1 }],
      custom_data: { org_id: 'org_1' },
      customer_id: 'ctm_1',
    });

    const portal = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { urls: { general: { overview: 'https://portal/x' } } } }),
        ),
    );
    expect(
      await createPortalSession(
        { ...configured, PADDLE_ENVIRONMENT: 'production' },
        { customerId: 'ctm_1', subscriptionId: 'sub_1' },
        portal as unknown as typeof fetch,
      ),
    ).toEqual({ url: 'https://portal/x' });
    expect((portal.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.paddle.com/customers/ctm_1/portal-sessions',
    );
    const failing = vi.fn(async () => new Response('no', { status: 500 }));
    await expect(
      createCheckout(
        configured,
        { priceId: 'p', orgId: 'o', customerId: null },
        failing as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('verifyPaddle', () => {
  it('takes a right, recent signature and refuses a wrong or stale one', async () => {
    const now = 1_800_000_000;
    const header = await signPaddle('secret', now, '{"a":1}');
    expect(await verifyPaddle('secret', header, '{"a":1}', now)).toBe(true);
    expect(await verifyPaddle('secret', `${header};h1=00`, '{"a":1}', now)).toBe(true);
    expect(await verifyPaddle('secret', header, '{"a":2}', now)).toBe(false);
    expect(await verifyPaddle('other', header, '{"a":1}', now)).toBe(false);
    expect(await verifyPaddle('secret', header, '{"a":1}', now + 301)).toBe(false);
    expect(await verifyPaddle('secret', null, '{"a":1}', now)).toBe(false);
  });
});

describe('plan limits (TUI-74)', () => {
  it('make an org read-only once its trial ends with no subscription', async () => {
    const { api, setOrg } = await setup();
    await setOrg({ trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      status: 'trialing',
      canWrite: false,
    });
    const res = await api('POST', '/subjects', { name: 'Science' });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('subscription_required');
    expect((await api('GET', '/branches')).status).toBe(200);
  });

  it('cap active students: Solo holds 30, counting students once and only current enrolments', async () => {
    const { api, make, setOrg, org } = await setup();
    await setOrg({ plan: 'solo', status: 'active' });
    const main = (await api('GET', '/branches')).body.data[0] as Row;
    const subject = await make('/subjects', { name: 'Mathematics' });
    const grade = await make('/grade-levels', { name: 'Year 10' });
    const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
    const addClass = (name: string) =>
      make('/classes', {
        courseId: course.id,
        branchId: main.id,
        name,
        startDate: addDays(today(), -30),
      });
    const maths = await addClass('Maths');
    const extra = await addClass('Extra maths');
    const family = await make('/families', { name: 'Perera', branchId: main.id });
    const student = (firstName: string) =>
      make('/students', { familyId: family.id, firstName, lastName: 'Perera' });
    const aroha = await student('Aroha');
    expect(
      (await api('POST', '/enrolments', { studentId: aroha.id, classId: maths.id })).status,
    ).toBe(201);
    // 29 more students enrolled, and one whose enrolment has ended (not counted).
    const others = Array.from({ length: 30 }, (_, i) => ({
      id: newId('enrolment'),
      orgId: org.id,
      studentId: newId('student'),
      classId: maths.id,
      startDate: addDays(today(), -30),
      endDate: i === 29 ? addDays(today(), -1) : null,
    }));
    for (let i = 0; i < others.length; i += 9) {
      await db()
        .insert(enrolments)
        .values(others.slice(i, i + 9));
    }
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      studentLimit: 30,
      activeStudents: 30,
    });

    // Aroha is already counted: a second class is fine.
    expect(
      (await api('POST', '/enrolments', { studentId: aroha.id, classId: extra.id })).status,
    ).toBe(201);
    const sam = await student('Sam');
    const full = await api('POST', '/enrolments', { studentId: sam.id, classId: maths.id });
    expect(full.status).toBe(402);
    expect(full.body.error).toMatchObject({
      code: 'plan_limit',
      fields: { studentId: ['Plan limit'] },
    });

    // Small holds 150.
    await setOrg({ plan: 'small' });
    expect(
      (await api('POST', '/enrolments', { studentId: sam.id, classId: maths.id })).status,
    ).toBe(201);
  });
});
