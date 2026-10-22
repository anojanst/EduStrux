import { adminAccessLog } from '@edustrux/db';
import { env } from 'cloudflare:workers';
import { desc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createActorToken } from '../src/lib/clerk';
import { call, db, newOrg, newUser, tokenFor } from './helpers';

// The super-admin console (TUI-75): every org, support changes, and logged impersonation.

const admin = async () => {
  const token = await tokenFor('user_super_admin');
  return (method: string, path: string, body?: unknown) =>
    call(method, `/api/v1/admin${path}`, { token, body });
};

const logOf = (orgId: string) =>
  db()
    .select()
    .from(adminAccessLog)
    .where(eq(adminAccessLog.orgId, orgId))
    .orderBy(desc(adminAccessLog.createdAt), desc(adminAccessLog.id));

describe('the super-admin console', () => {
  it('lists and finds orgs with their owners, and is 404 for anyone else', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token, 'Harmony Music School');
    const as = await admin();
    const list = await as('GET', '/orgs?q=harm');
    expect(list.status).toBe(200);
    const found = list.body.data.find((o: { id: string }) => o.id === org.id);
    expect(found).toMatchObject({
      name: 'Harmony Music School',
      plan: 'trial',
      owners: [{ userId: owner.userId, email: 'owner@example.com' }],
    });
    expect(
      (await as('GET', '/orgs?q=zzz-nothing')).body.data.some(
        (o: { id: string }) => o.id === org.id,
      ),
    ).toBe(false);

    const detail = await as('GET', `/orgs/${org.id}`);
    expect(detail.body).toMatchObject({
      id: org.id,
      members: 1,
      families: 0,
      students: 0,
      billing: { plan: 'trial', canWrite: true, studentLimit: 150, subscription: null },
    });
    expect((await as('GET', '/orgs/org_missing')).status).toBe(404);

    expect((await call('GET', '/api/v1/admin/orgs', { token: owner.token })).status).toBe(404);
    expect((await call('GET', '/api/v1/admin/orgs')).status).toBe(401);
    expect((await logOf(org.id))[0]).toMatchObject({
      action: 'admin.request',
      adminClerkUserId: 'user_super_admin',
      method: 'GET',
      path: `/api/v1/admin/orgs/${org.id}`,
    });
  });

  it('changes an org’s plan, status or trial, in the org’s audit log', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const as = await admin();
    const before = (await as('GET', `/orgs/${org.id}`)).body;
    const trialEndsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await as('PATCH', `/orgs/${org.id}`, {
      updatedAt: before.updatedAt,
      plan: 'custom',
      trialEndsAt,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: 'custom',
      trialEndsAt,
      billing: { studentLimit: null },
    });
    const stale = await as('PATCH', `/orgs/${org.id}`, {
      updatedAt: before.updatedAt,
      status: 'suspended',
    });
    expect(stale.status).toBe(409);
    expect(
      (await as('PATCH', `/orgs/${org.id}`, { updatedAt: before.updatedAt, plan: 'gold' })).status,
    ).toBe(400);

    const audit = await call('GET', `/api/v1/orgs/${org.id}/audit-log?limit=1`, {
      token: owner.token,
    });
    expect(audit.body.data[0]).toMatchObject({
      action: 'org.admin_updated',
      before: { plan: 'trial' },
      after: { plan: 'custom', trialEndsAt },
    });
  });

  it('starts impersonation through Clerk, recorded with the reason', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const as = await admin();
    // No CLERK_SECRET_KEY in tests.
    const res = await as('POST', `/orgs/${org.id}/impersonate`, { reason: 'Invoice question' });
    expect(res.status).toBe(503);
    expect((await as('POST', `/orgs/${org.id}/impersonate`, { reason: '' })).status).toBe(400);
    expect(
      (await as('POST', `/orgs/${org.id}/impersonate`, { userId: 'usr_x', reason: 'Help' })).status,
    ).toBe(404);

    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ id: 'act_1', url: 'https://clerk/sign-in?t=x' })),
    );
    const link = await createActorToken(
      { ...env, CLERK_SECRET_KEY: 'sk_test' },
      { userClerkId: 'user_owner', adminClerkId: 'user_super_admin' },
      fetchFn as unknown as typeof fetch,
    );
    expect(link).toEqual({ url: 'https://clerk/sign-in?t=x', expiresAt: expect.any(String) });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.clerk.com/v1/actor_tokens');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
    expect(JSON.parse(init.body as string)).toMatchObject({
      user_id: 'user_owner',
      actor: { sub: 'user_super_admin' },
      expires_in_seconds: 600,
    });
  });

  it('logs every request made while signed in as someone else, and keeps admin routes shut', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const asOwner = await tokenFor(owner.clerkUserId, { act: { sub: 'user_super_admin' } });
    const res = await call('GET', `/api/v1/orgs/${org.id}/branches`, { token: asOwner });
    expect(res.status).toBe(200);
    expect((await logOf(org.id))[0]).toMatchObject({
      action: 'impersonated.request',
      adminClerkUserId: 'user_super_admin',
      method: 'GET',
      path: `/api/v1/orgs/${org.id}/branches`,
    });
    // An admin who is impersonating can't reach the console in that session.
    const chained = await tokenFor('user_super_admin_2', { act: { sub: 'user_super_admin' } });
    expect((await call('GET', '/api/v1/admin/orgs', { token: chained })).status).toBe(404);
  });
});
