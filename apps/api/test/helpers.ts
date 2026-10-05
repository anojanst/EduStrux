import { createDb, memberships } from '@edustrux/db';
import { newId, type Role } from '@edustrux/shared';
import { env, exports } from 'cloudflare:workers';
import { importPKCS8, SignJWT } from 'jose';

export const db = () => createDb(env.DB);

/** A Clerk-shaped session token for a made-up Clerk user. */
export async function tokenFor(clerkUserId: string, claims: Record<string, unknown> = {}) {
  const key = await importPKCS8(env.TEST_JWT_PRIVATE_KEY, 'RS256');
  return new SignJWT({ sid: 'sess_test', ...claims })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setSubject(clerkUserId)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime('5m')
    .sign(key);
}

type CallOptions = {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function call(method: string, path: string, options: CallOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await exports.default.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/** A fresh signed-in user. Each call makes a new Clerk id, so tests don't share state. */
export async function newUser(label = 'user') {
  const clerkUserId = `user_test_${label}_${crypto.randomUUID().slice(0, 8)}`;
  const token = await tokenFor(clerkUserId, { email: `${label}@example.com` });
  const me = await call('GET', '/api/v1/me', { token });
  return { clerkUserId, token, userId: me.body.id as string };
}

export const sampleOrg = (name = 'Bright Minds Tuition') => ({
  name,
  currency: 'NZD',
  timezone: 'Pacific/Auckland',
  locale: 'en-NZ',
  country: 'NZ',
});

export async function newOrg(token: string, name?: string) {
  const res = await call('POST', '/api/v1/orgs', { token, body: sampleOrg(name) });
  if (res.status !== 201) throw new Error(`org create failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; updatedAt: string; slug: string };
}

/** Adds an existing user to an org with the given role, bypassing invitations. */
export async function addMember(orgId: string, clerkUserId: string, role: Role) {
  const token = await tokenFor(clerkUserId);
  await call('GET', '/api/v1/me', { token }); // ensures the users row exists
  const user = await db().query.users.findFirst({
    where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
  });
  await db()
    .insert(memberships)
    .values({ id: newId('membership'), orgId, userId: user!.id, role, branchIds: null });
  return token;
}
