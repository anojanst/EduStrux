import { describe, expect, it } from 'vitest';
import { call, newUser, tokenFor } from './helpers';

describe('auth', () => {
  it('health needs no token', async () => {
    const res = await call('GET', '/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, environment: 'test' });
  });

  it('rejects requests without a token', async () => {
    const res = await call('GET', '/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects a token signed with another key', async () => {
    const forged = (await tokenFor('user_x')).split('.').slice(0, 2).join('.') + '.c2lnbmF0dXJl';
    const res = await call('GET', '/api/v1/me', { token: forged });
    expect(res.status).toBe(401);
  });

  it('creates the user on first request and reuses it after', async () => {
    const { token, userId } = await newUser('first');
    expect(userId).toMatch(/^usr_[0-9a-z]{26}$/);

    const again = await call('GET', '/api/v1/me', { token });
    expect(again.body.id).toBe(userId);
    expect(again.body.email).toBe('first@example.com');
    expect(again.body.memberships).toEqual([]);
  });

  it('keeps the email and name the session token carries, and treats a blank one as none', async () => {
    const clerkUserId = `user_claims_${crypto.randomUUID()}`;
    const first = await call('GET', '/api/v1/me', { token: await tokenFor(clerkUserId) });
    expect(first.body).toMatchObject({ email: null, name: null });

    const named = await tokenFor(clerkUserId, { email: 'ana@example.com', name: 'Ana Silva' });
    expect((await call('GET', '/api/v1/me', { token: named })).body).toMatchObject({
      email: 'ana@example.com',
      name: 'Ana Silva',
    });

    const blank = await tokenFor(clerkUserId, { email: 'ana@example.com', name: ' ' });
    expect((await call('GET', '/api/v1/me', { token: blank })).body.name).toBe('Ana Silva');
  });
});
