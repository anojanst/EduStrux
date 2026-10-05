import { verifyToken } from '@clerk/backend';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Bindings } from '../env';
import { unauthenticated } from '../lib/errors';
import { findOrCreateUser } from '../modules/users/repository';

function readToken(authorization: string | undefined, cookie: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  // Mobile and Swagger send a Bearer header; the web app sends Clerk's __session cookie.
  return match?.[1] ?? cookie ?? null;
}

function verifyOptions(env: Bindings) {
  if (!env.CLERK_JWT_KEY && !env.CLERK_SECRET_KEY) {
    throw new Error('Set CLERK_JWT_KEY or CLERK_SECRET_KEY (see apps/api/.dev.vars.example)');
  }
  const parties = env.CLERK_AUTHORIZED_PARTIES.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    // A local public key avoids a network call; otherwise Clerk's JWKS is fetched and cached.
    jwtKey: env.CLERK_JWT_KEY,
    secretKey: env.CLERK_SECRET_KEY,
    authorizedParties: parties.length ? parties : undefined,
  };
}

/** Verifies the Clerk session token and loads (or creates) our user row. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = readToken(c.req.header('Authorization'), getCookie(c, '__session'));
  if (!token) throw unauthenticated();

  const options = verifyOptions(c.env);
  let claims: Record<string, unknown>;
  try {
    claims = await verifyToken(token, options);
  } catch {
    throw unauthenticated('Invalid or expired session token');
  }

  const sub = claims.sub;
  if (typeof sub !== 'string') throw unauthenticated('Token has no subject');

  c.set(
    'user',
    await findOrCreateUser(c.var.db, {
      clerkUserId: sub,
      // Present when the Clerk session token is customised to include them.
      email: typeof claims.email === 'string' ? claims.email : null,
      name: typeof claims.name === 'string' ? claims.name : null,
    }),
  );
  await next();
});
