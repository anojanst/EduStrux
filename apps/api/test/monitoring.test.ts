import { orgs } from '@edustrux/db';
import { addDays, localNow } from '@edustrux/shared';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { runDaily } from '../src/background/scheduled';
import type { Bindings } from '../src/env';
import { call, db, newOrg, newUser } from './helpers';

// Rate limits per user and per org (TUI-81), the readiness check and the nightly backup check
// (TUI-83).

afterEach(() => vi.restoreAllMocks());

/** A limiter that refuses the keys listed, and records every key it was asked about. */
function limiter(refused: string[] = []) {
  const keys: string[] = [];
  return {
    keys,
    limit: vi.fn(async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: !refused.includes(key) };
    }),
  };
}

/** A request to the app with these bindings added: tests have no limiters bound otherwise. */
async function callWith(bindings: Partial<Bindings>, path: string, token: string) {
  const res = await createApp().fetch(
    new Request(`http://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    { ...env, ...bindings } as Bindings,
    createExecutionContext(),
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

describe('rate limits (TUI-81)', () => {
  it('refuses a user over the limit with 429 and Retry-After, before reading the database', async () => {
    const user = await newUser();
    const users = limiter([user.clerkUserId]);
    const res = await callWith({ USER_RATE_LIMIT: users }, '/api/v1/me', user.token);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers.get('Server-Timing')).toMatch(/trips=0;/);

    // Someone else carries on.
    const other = await newUser();
    expect((await callWith({ USER_RATE_LIMIT: users }, '/api/v1/me', other.token)).status).toBe(
      200,
    );
    expect(users.keys).toEqual([user.clerkUserId, other.clerkUserId]);
  });

  it('counts an org’s requests only once membership is known', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const orgLimit = limiter([org.id]);
    const res = await callWith(
      { ORG_RATE_LIMIT: orgLimit },
      `/api/v1/orgs/${org.id}/branches`,
      owner.token,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');

    // Someone outside the org gets 404, and doesn't count against it.
    orgLimit.keys.length = 0;
    const stranger = await newUser('owner_b');
    const outside = await callWith(
      { ORG_RATE_LIMIT: orgLimit },
      `/api/v1/orgs/${org.id}/branches`,
      stranger.token,
    );
    expect(outside.status).toBe(404);
    expect(orgLimit.keys).toEqual([]);

    // Another org's own requests go through.
    const otherOrg = await newOrg(stranger.token, 'Harmony Music School');
    const theirs = await callWith(
      { ORG_RATE_LIMIT: orgLimit },
      `/api/v1/orgs/${otherOrg.id}/branches`,
      stranger.token,
    );
    expect(theirs.status).toBe(200);
  });

  it('lets the request through when the limiter fails', async () => {
    const user = await newUser();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      limit: vi.fn(async () => {
        throw new Error('limiter down');
      }),
    };
    expect((await callWith({ USER_RATE_LIMIT: broken }, '/api/v1/me', user.token)).status).toBe(
      200,
    );
  });
});

describe('the readiness check (TUI-83)', () => {
  it('answers once the database has answered a query, with no sign-in', async () => {
    const res = await call('GET', '/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, environment: 'test', database: 'ok' });
    expect(res.db.trips).toBe(1);
  });
});

describe('the nightly backup check (TUI-83)', () => {
  it('logs an error for an org with no backup from last night, and not for one that has it', async () => {
    const owner = await newUser('owner');
    const missing = await newOrg(owner.token);
    const backedUp = await newOrg(owner.token, 'Harmony Music School');
    const young = await newOrg(owner.token, 'New Leaf Tutoring');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    for (const id of [missing.id, backedUp.id]) {
      await db().update(orgs).set({ createdAt: twoDaysAgo }).where(eq(orgs.id, id));
    }
    const at = new Date();
    const lastNight = addDays(localNow('Pacific/Auckland', at).date, -1);
    await env.FILES.put(`backups/${backedUp.id}/${lastNight}.json`, '{}');

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const done = await runDaily(db(), env, at);
    const lines = logged.mock.calls.map((args) => String(args[0]));
    expect(lines).toContain(`daily cron: org ${missing.id} has no backup for ${lastNight}`);
    expect(lines.some((line) => line.includes(backedUp.id))).toBe(false);
    // An org younger than a day has had no night yet.
    expect(lines.some((line) => line.includes(young.id))).toBe(false);
    expect(done.backupsMissing).toBeGreaterThanOrEqual(1);
  });
});
