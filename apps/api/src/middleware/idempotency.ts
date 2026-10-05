import { idempotencyKeys } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Honours an `Idempotency-Key` header: the first successful (2xx) response is stored and
 * replayed for retries of the same request. Without the header the request runs normally.
 *
 * `scopeOf` picks whose keys these are: the org for org routes, the user for routes outside one.
 */
export function idempotent(scopeOf: (c: Context<AppEnv>) => string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header('Idempotency-Key');
    if (!key) return next();
    if (key.length > 255) {
      throw new ApiError(
        400,
        'validation_failed',
        'Idempotency-Key must be at most 255 characters',
      );
    }

    const db = c.var.db;
    const scope = scopeOf(c);
    const requestHash = await sha256(`${c.req.method} ${c.req.path}\n${await c.req.text()}`);

    // Claim the key first, so a concurrent retry sees "in progress" instead of running twice.
    const claimed = await db
      .insert(idempotencyKeys)
      .values({ id: newId('idempotency'), scope, key, requestHash })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    if (claimed.length === 0) {
      const existing = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
        .get();
      if (!existing) throw new ApiError(409, 'request_in_progress', 'Retry this request');
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          422,
          'idempotency_key_reused',
          'This Idempotency-Key was already used for a different request',
        );
      }
      if (existing.statusCode === null || existing.responseBody === null) {
        throw new ApiError(409, 'request_in_progress', 'A request with this key is still running');
      }
      return c.body(existing.responseBody, existing.statusCode as 200, {
        'Content-Type': 'application/json',
        'Idempotent-Replayed': 'true',
      });
    }

    const rowId = claimed[0]!.id;
    await next();

    // Hono turns thrown errors into c.res via onError, so check the outcome here.
    if (c.res.status >= 200 && c.res.status < 300 && !c.error) {
      await db
        .update(idempotencyKeys)
        .set({ statusCode: c.res.status, responseBody: await c.res.clone().text() })
        .where(eq(idempotencyKeys.id, rowId));
    } else {
      // Failed requests release the key so the client can fix the request and retry.
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, rowId));
    }
  });
}

export const byOrg = (c: Context<AppEnv>) => c.var.membership.orgId;
export const byUser = (c: Context<AppEnv>) => c.var.user.id;
