// Stripe Billing (TUI-106, replacing Paddle): the two API calls the subscription routes make, and
// the check of Stripe's webhook signature. Plain fetch and WebCrypto, no SDK.
import type { Bindings } from '../env';
import { ApiError, unavailable } from './errors';

/** How far a webhook's `t` may be from now, either way, before it is refused (Stripe's default). */
export const STRIPE_TOLERANCE_SECONDS = 5 * 60;

const API = 'https://api.stripe.com/v1';

/** The price ids, by `{plan}_{interval}`, from `STRIPE_PRICE_IDS` (JSON). */
export function priceIds(env: Bindings): Record<string, string> {
  if (!env.STRIPE_PRICE_IDS) return {};
  try {
    const parsed = JSON.parse(env.STRIPE_PRICE_IDS) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

/** Where Stripe sends the owner back to: the org's billing settings in the web app. */
function billingPage(env: Bindings, orgSlug: string) {
  if (!env.APP_URL) throw unavailable('Subscription billing isn’t set up yet.');
  return `${env.APP_URL.replace(/\/$/, '')}/o/${encodeURIComponent(orgSlug)}/settings/billing`;
}

/** Stripe takes form-encoded bodies; nested fields are `a[b][c]`. */
function form(params: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, value);
  return body.toString();
}

async function call<T>(
  env: Bindings,
  path: string,
  params: Record<string, string | undefined>,
  fetchFn: typeof fetch,
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw unavailable('Subscription billing isn’t set up yet.');
  const res = await fetchFn(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error(`Stripe ${path} answered ${res.status}: ${detail}`);
    throw new ApiError(503, 'unavailable', 'Stripe couldn’t be reached. Please try again.');
  }
  return (await res.json()) as T;
}

/**
 * A hosted Checkout Session for one price. The org's id goes on the session and, as metadata, on
 * the subscription it starts, which is how the webhook finds the org. An org that subscribed
 * before reuses its Stripe customer. With `STRIPE_AUTOMATIC_TAX` on, Stripe Tax adds sales tax.
 */
export async function createCheckout(
  env: Bindings,
  input: { priceId: string; orgId: string; orgSlug: string; customerId: string | null },
  fetchFn: typeof fetch = fetch,
) {
  const back = billingPage(env, input.orgSlug);
  const tax = env.STRIPE_AUTOMATIC_TAX === 'true';
  const data = await call<{ id: string; url: string }>(
    env,
    '/checkout/sessions',
    {
      mode: 'subscription',
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: input.orgId,
      'subscription_data[metadata][org_id]': input.orgId,
      customer: input.customerId ?? undefined,
      success_url: `${back}?checkout=success`,
      cancel_url: `${back}?checkout=cancelled`,
      'automatic_tax[enabled]': tax ? 'true' : undefined,
      // Stripe Tax needs the customer's address, and a returning customer's may change.
      'customer_update[address]': tax && input.customerId ? 'auto' : undefined,
    },
    fetchFn,
  );
  return { sessionId: data.id, url: data.url };
}

/** A link into Stripe's Billing Portal, where the owner changes plan or card, or cancels. */
export async function createPortalSession(
  env: Bindings,
  input: { customerId: string; orgSlug: string },
  fetchFn: typeof fetch = fetch,
) {
  const back = billingPage(env, input.orgSlug);
  const data = await call<{ url: string }>(
    env,
    '/billing_portal/sessions',
    { customer: input.customerId, return_url: back },
    fetchFn,
  );
  return { url: data.url };
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content)));
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether `Stripe-Signature` (`t=…,v1=…`, maybe several `v1` while a secret rotates) is an
 * HMAC-SHA256 of `{t}.{body}` by the endpoint's signing secret, made recently.
 */
export async function verifyStripe(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header) return false;
  const parts = header.split(',').map((part) => part.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(t)) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = await hmac(secret, `${t}.${body}`);
  return signatures.some((signature) => same(signature, expected));
}

/** Signs a body as Stripe would, for tests. */
export async function signStripe(secret: string, t: number, body: string) {
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
}
