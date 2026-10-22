// Checks a webhook signed the Svix way, which both Clerk and Resend use: headers `svix-id`,
// `svix-timestamp` and `svix-signature` (`v1,<base64>` entries, space-separated), signed with
// HMAC-SHA256 over `{id}.{timestamp}.{body}` by the base64 key after the secret's `whsec_`.

/** How far a delivery's timestamp may be from now, either way, before it is refused. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function sign(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content)));
}

/** Compares in time that doesn't depend on where they differ. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The delivery's id when its signature is right and its timestamp recent, else null.
 * `nowSeconds` is for tests.
 */
export async function verifySvix(
  secret: string,
  headers: { get(name: string): string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return null;
  if (Math.abs(nowSeconds - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return null;
  let expected: string;
  try {
    expected = await sign(secret, `${id}.${timestamp}.${body}`);
  } catch {
    return null; // a secret that isn't base64
  }
  const ok = signatures
    .split(' ')
    .map((entry) => entry.split(','))
    .some(([version, signature]) => version === 'v1' && !!signature && same(signature, expected));
  return ok ? id : null;
}

/** Signs a body as Svix would, for tests and local tools. */
export async function signSvix(secret: string, id: string, timestamp: number, body: string) {
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${await sign(secret, `${id}.${timestamp}.${body}`)}`,
  };
}
