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
});
