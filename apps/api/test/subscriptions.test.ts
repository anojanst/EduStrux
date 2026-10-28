import { enrolments, memberships, orgs } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/errors';
import { createCheckout, createPortalSession, signStripe, verifyStripe } from '../src/lib/stripe';
import { call, db, newOrg, newUser } from './helpers';

// The org's subscription through Stripe (TUI-106; Paddle in TUI-73), and what its plan allows
// (TUI-74).

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
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A Stripe `customer.subscription.*` event for the org, as Stripe sends it. */
function subscriptionEvent(
  orgId: string,
  overrides: {
    type?: string;
    id?: string;
    status?: string;
    priceId?: string;
    occurredAt?: string;
    eventId?: string;
    cancelAt?: string;
  } = {},
) {
  return {
    id: overrides.eventId ?? `evt_${++events}_${crypto.randomUUID()}`,
    object: 'event',
    type: overrides.type ?? 'customer.subscription.created',
    created: seconds(overrides.occurredAt ?? new Date().toISOString()),
    data: {
      object: {
        id: overrides.id ?? `sub_${orgId}`,
        object: 'subscription',
        status: overrides.status ?? 'active',
        customer: 'cus_1',
        items: {
          object: 'list',
          data: [
            {
              price: {
                id: overrides.priceId ?? 'price_solo_month',
                recurring: { interval: 'month' },
              },
              current_period_end: seconds('2026-11-01T00:00:00Z'),
            },
          ],
        },
        metadata: { org_id: orgId },
        cancel_at: overrides.cancelAt ? seconds(overrides.cancelAt) : null,
        cancel_at_period_end: false,
        canceled_at: null,
      },
    },
  };
}

async function stripeDeliver(payload: unknown, secret = env.STRIPE_WEBHOOK_SECRET!) {
  const body = JSON.stringify(payload);
  const res = await exports.default.fetch(
    new Request('http://api.test/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': await signStripe(secret, Math.floor(Date.now() / 1000), body),
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

  it('is 404 for another org', async () => {
    const { base } = await setup();
    const other = await newUser('owner');
    await newOrg(other.token);
    const res = await call('GET', `${base}/billing/subscription`, { token: other.token });
    expect(res.status).toBe(404);
  });
});

describe('the Stripe webhook', () => {
  it('records a new subscription and sets the org’s plan, once per event', async () => {
    const { org, api } = await setup();
    const event = subscriptionEvent(org.id);
    expect(await stripeDeliver(event)).toEqual({
      status: 200,
      body: { received: true, duplicate: false },
    });
    expect((await stripeDeliver(event)).body.duplicate).toBe(true);
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
        currentPeriodEnd: '2026-11-01T00:00:00.000Z',
        cancelAt: null,
      },
    });
    const audit = (await api('GET', '/audit-log?limit=1')).body.data[0];
    expect(audit).toMatchObject({ action: 'subscription.created', actorUserId: null });

    // Upgraded to Small yearly, and the owner asks to cancel at the period's end.
    await stripeDeliver(
      subscriptionEvent(org.id, {
        type: 'customer.subscription.updated',
        priceId: 'price_small_year',
        cancelAt: '2027-10-01T00:00:00Z',
      }),
    );
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'small',
      subscription: { plan: 'small', cancelAt: '2027-10-01T00:00:00.000Z' },
    });
    expect((await api('GET', '/audit-log?limit=1')).body.data[0]).toMatchObject({
      action: 'subscription.updated',
      actorUserId: null,
    });

    // An older event arriving late changes nothing.
    await stripeDeliver(
      subscriptionEvent(org.id, {
        type: 'customer.subscription.updated',
        status: 'past_due',
        occurredAt: '2020-01-01T00:00:00Z',
      }),
    );
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'small',
      status: 'active',
    });

    // A price not in STRIPE_PRICE_IDS is the custom plan.
    await stripeDeliver(
      subscriptionEvent(org.id, { type: 'customer.subscription.updated', priceId: 'price_deal' }),
    );
    expect((await api('GET', '/billing/subscription')).body.plan).toBe('custom');
  });

  it('keeps the trial while the first payment is incomplete', async () => {
    const { org, api } = await setup();
    await stripeDeliver(subscriptionEvent(org.id, { status: 'incomplete' }));
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'trial',
      status: 'trialing',
      subscription: { status: 'incomplete' },
    });
    // Not live: the owner may start another checkout (503 here: no secret key).
    expect((await api('POST', '/billing/checkout', { plan: 'solo' })).status).toBe(503);
    await stripeDeliver(subscriptionEvent(org.id, { type: 'customer.subscription.updated' }));
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      plan: 'solo',
      status: 'active',
    });
  });

  it('suspends an unpaid org', async () => {
    const { org, api } = await setup();
    await stripeDeliver(subscriptionEvent(org.id));
    await stripeDeliver(
      subscriptionEvent(org.id, { type: 'customer.subscription.updated', status: 'unpaid' }),
    );
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      status: 'suspended',
      canWrite: false,
    });
    expect((await api('POST', '/subjects', { name: 'Science' })).status).toBe(402);
  });

  it('makes a cancelled org read-only, but it can still read, export and subscribe', async () => {
    const { org, api, make } = await setup();
    await stripeDeliver(subscriptionEvent(org.id));
    await stripeDeliver(
      subscriptionEvent(org.id, { type: 'customer.subscription.deleted', status: 'canceled' }),
    );
    const overview = (await api('GET', '/billing/subscription')).body;
    expect(overview).toMatchObject({ status: 'cancelled', canWrite: false });

    const write = await api('POST', '/subjects', { name: 'Science' });
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe('subscription_required');
    expect((await api('GET', '/subjects')).status).toBe(200);
    expect((await api('POST', '/exports')).status).toBe(202);
    // A cancelled subscription isn't live, so a new checkout may start (503 here: no secret key).
    const again = await api('POST', '/billing/checkout', { plan: 'small', interval: 'year' });
    expect(again.status).toBe(503);

    // Subscribing again: a new subscription becomes the org's.
    await stripeDeliver(subscriptionEvent(org.id, { id: `sub_new_${org.id}` }));
    expect((await api('GET', '/billing/subscription')).body).toMatchObject({
      status: 'active',
      canWrite: true,
    });
    // A late event for the old one leaves the org alone.
    await stripeDeliver(
      subscriptionEvent(org.id, { type: 'customer.subscription.updated', status: 'canceled' }),
    );
    expect((await api('GET', '/billing/subscription')).body.status).toBe('active');
    expect((await make('/subjects', { name: 'Science' })).id).toMatch(/^sbj_/);
  });

  it('refuses a bad signature, and ignores a subscription with no org or other events', async () => {
    const { org, api } = await setup();
    expect((await stripeDeliver(subscriptionEvent(org.id), 'wrong-secret')).status).toBe(401);
    const orphan = subscriptionEvent('org_missing', { id: 'sub_orphan' });
    expect((await stripeDeliver(orphan)).status).toBe(200);
    expect((await stripeDeliver({ id: 'evt_x' })).status).toBe(400);
    const invoice = {
      id: `evt_invoice_${crypto.randomUUID()}`,
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_1' } },
    };
    expect((await stripeDeliver(invoice)).status).toBe(200);
    expect((await api('GET', '/billing/subscription')).body.subscription).toBeNull();
  });
});

describe('POST /billing/checkout and /billing/portal', () => {
  it('refuse a second subscription, and need one for the portal', async () => {
    const { org, api, member } = await setup();
    expect((await api('POST', '/billing/portal')).status).toBe(422);
    expect((await api('POST', '/billing/checkout', { plan: 'solo' })).status).toBe(503);
    expect((await api('POST', '/billing/checkout', { plan: 'gold' })).status).toBe(400);
    await stripeDeliver(subscriptionEvent(org.id));
    const second = await api('POST', '/billing/checkout', { plan: 'small' });
    expect(second.status).toBe(422);
    expect(second.body.error.fields).toEqual({ plan: ['Already subscribed'] });
    expect((await api('POST', '/billing/portal')).status).toBe(503);
    const manager = await member('branch_manager');
    expect((await manager.as('POST', '/billing/checkout', { plan: 'solo' })).status).toBe(403);
    expect((await manager.as('POST', '/billing/portal')).status).toBe(403);
  });

  it('are 404 for another org', async () => {
    const { base } = await setup();
    const other = await newUser('owner');
    await newOrg(other.token);
    const as = (path: string, body?: unknown) =>
      call('POST', `${base}${path}`, { token: other.token, body });
    expect((await as('/billing/checkout', { plan: 'solo' })).status).toBe(404);
    expect((await as('/billing/portal')).status).toBe(404);
  });

  it('call Stripe’s API with the org’s id, and send the owner back to the app', async () => {
    const configured = { ...env, STRIPE_SECRET_KEY: 'sk_test_1', APP_URL: 'https://app.test/' };
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe/x' })),
    );
    const out = await createCheckout(
      configured,
      { priceId: 'price_solo_month', orgId: 'org_1', orgSlug: 'kiwi', customerId: 'cus_1' },
      fetchFn as unknown as typeof fetch,
    );
    expect(out).toEqual({ sessionId: 'cs_1', url: 'https://checkout.stripe/x' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_1');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      mode: 'subscription',
      'line_items[0][price]': 'price_solo_month',
      'line_items[0][quantity]': '1',
      client_reference_id: 'org_1',
      'subscription_data[metadata][org_id]': 'org_1',
      customer: 'cus_1',
      success_url: 'https://app.test/o/kiwi/settings/billing?checkout=success',
      cancel_url: 'https://app.test/o/kiwi/settings/billing?checkout=cancelled',
    });

    // With Stripe Tax on, checkout asks Stripe to add tax.
    const taxed = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_2', url: 'u' })));
    await createCheckout(
      { ...configured, STRIPE_AUTOMATIC_TAX: 'true' },
      { priceId: 'price_solo_month', orgId: 'org_1', orgSlug: 'kiwi', customerId: null },
      taxed as unknown as typeof fetch,
    );
    const taxBody = new URLSearchParams(
      (taxed.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(taxBody.get('automatic_tax[enabled]')).toBe('true');
    expect(taxBody.has('customer')).toBe(false);

    const portal = vi.fn(
      async () => new Response(JSON.stringify({ url: 'https://billing.stripe/p' })),
    );
    expect(
      await createPortalSession(
        configured,
        { customerId: 'cus_1', orgSlug: 'kiwi' },
        portal as unknown as typeof fetch,
      ),
    ).toEqual({ url: 'https://billing.stripe/p' });
    const [portalUrl, portalInit] = portal.mock.calls[0] as unknown as [string, RequestInit];
    expect(portalUrl).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    expect(Object.fromEntries(new URLSearchParams(portalInit.body as string))).toEqual({
      customer: 'cus_1',
      return_url: 'https://app.test/o/kiwi/settings/billing',
    });

    const failing = vi.fn(async () => new Response('no', { status: 500 }));
    await expect(
      createCheckout(
        configured,
        { priceId: 'p', orgId: 'o', orgSlug: 's', customerId: null },
        failing as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ApiError);
    // Without APP_URL there is nowhere to send the owner back to.
    await expect(
      createCheckout(
        { ...configured, APP_URL: undefined },
        { priceId: 'p', orgId: 'o', orgSlug: 's', customerId: null },
        failing as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('verifyStripe', () => {
  it('takes a right, recent signature and refuses a wrong or stale one', async () => {
    const now = 1_800_000_000;
    const header = await signStripe('secret', now, '{"a":1}');
    expect(await verifyStripe('secret', header, '{"a":1}', now)).toBe(true);
    expect(await verifyStripe('secret', `${header},v1=00`, '{"a":1}', now)).toBe(true);
    expect(await verifyStripe('secret', header, '{"a":2}', now)).toBe(false);
    expect(await verifyStripe('other', header, '{"a":1}', now)).toBe(false);
    expect(await verifyStripe('secret', header, '{"a":1}', now + 301)).toBe(false);
    expect(await verifyStripe('secret', null, '{"a":1}', now)).toBe(false);
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
