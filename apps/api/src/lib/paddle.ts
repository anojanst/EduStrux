// Paddle Billing (TUI-73): the two API calls the subscription routes make, and the check of
// Paddle's webhook signature. Plain fetch and WebCrypto, no SDK.
import type { Bindings } from '../env';
import { ApiError, unavailable } from './errors';

/** How far a webhook's `ts` may be from now, either way, before it is refused. */
export const PADDLE_TOLERANCE_SECONDS = 5 * 60;

const apiBase = (env: Bindings) =>
  env.PADDLE_ENVIRONMENT === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

/** The price ids, by `{plan}_{interval}`, from `PADDLE_PRICE_IDS` (JSON). */
export function priceIds(env: Bindings): Record<string, string> {
  if (!env.PADDLE_PRICE_IDS) return {};
  try {
    const parsed = JSON.parse(env.PADDLE_PRICE_IDS) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

async function call<T>(
  env: Bindings,
  path: string,
  body: unknown,
  fetchFn: typeof fetch,
): Promise<T> {
  if (!env.PADDLE_API_KEY) throw unavailable('Subscription billing isn’t set up yet.');
  const res = await fetchFn(`${apiBase(env)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error(`Paddle ${path} answered ${res.status}: ${detail}`);
    throw new ApiError(503, 'unavailable', 'Paddle couldn’t be reached. Please try again.');
  }
  return ((await res.json()) as { data: T }).data;
}

/**
 * A checkout for one price: a Paddle transaction carrying the org's id, which Paddle copies onto
 * the subscription it starts. The web app opens it with Paddle.js; `url` is set when the Paddle
 * account has a default payment link.
 */
export async function createCheckout(
  env: Bindings,
  input: { priceId: string; orgId: string; customerId: string | null },
  fetchFn: typeof fetch = fetch,
) {
  const data = await call<{ id: string; checkout?: { url?: string | null } | null }>(
    env,
    '/transactions',
    {
      items: [{ price_id: input.priceId, quantity: 1 }],
      custom_data: { org_id: input.orgId },
      ...(input.customerId ? { customer_id: input.customerId } : {}),
    },
    fetchFn,
  );
  return { transactionId: data.id, checkoutUrl: data.checkout?.url ?? null };
}

/** A link into Paddle's customer portal, where the owner changes plan, card or cancels. */
export async function createPortalSession(
  env: Bindings,
  input: { customerId: string; subscriptionId: string },
  fetchFn: typeof fetch = fetch,
) {
  const data = await call<{ urls: { general: { overview: string } } }>(
    env,
    `/customers/${encodeURIComponent(input.customerId)}/portal-sessions`,
    { subscription_ids: [input.subscriptionId] },
    fetchFn,
  );
  return { url: data.urls.general.overview };
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
 * Whether `Paddle-Signature` (`ts=…;h1=…`, maybe several `h1` while a secret rotates) is an
 * HMAC-SHA256 of `{ts}:{body}` by the webhook's secret, made recently.
 */
export async function verifyPaddle(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header) return false;
  const parts = header.split(';').map((part) => part.split('='));
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const signatures = parts.filter(([k]) => k === 'h1').map(([, v]) => v ?? '');
  if (!ts || !/^\d+$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(ts)) > PADDLE_TOLERANCE_SECONDS) return false;
  const expected = await hmac(secret, `${ts}:${body}`);
  return signatures.some((signature) => same(signature, expected));
}

/** Signs a body as Paddle would, for tests. */
export async function signPaddle(secret: string, ts: number, body: string) {
  return `ts=${ts};h1=${await hmac(secret, `${ts}:${body}`)}`;
}
