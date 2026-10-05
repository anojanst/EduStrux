import { describe, expect, it } from 'vitest';
import { call, newUser, sampleOrg } from './helpers';

describe('Idempotency-Key', () => {
  it('replays the first response instead of creating twice', async () => {
    const { token } = await newUser();
    const headers = { 'Idempotency-Key': crypto.randomUUID() };
    const body = sampleOrg('Retry Academy');

    const first = await call('POST', '/api/v1/orgs', { token, headers, body });
    const retry = await call('POST', '/api/v1/orgs', { token, headers, body });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');

    const me = await call('GET', '/api/v1/me', { token });
    expect(me.body.memberships).toHaveLength(1);
  });

  it('rejects the same key with a different body', async () => {
    const { token } = await newUser();
    const headers = { 'Idempotency-Key': crypto.randomUUID() };

    await call('POST', '/api/v1/orgs', { token, headers, body: sampleOrg('One') });
    const reused = await call('POST', '/api/v1/orgs', { token, headers, body: sampleOrg('Two') });

    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('idempotency_key_reused');
  });

  it('releases the key when the request fails, so a fixed retry can use it', async () => {
    const { token } = await newUser();
    const headers = { 'Idempotency-Key': crypto.randomUUID() };

    const bad = await call('POST', '/api/v1/orgs', {
      token,
      headers,
      body: { ...sampleOrg(), currency: 'bad' },
    });
    expect(bad.status).toBe(400);

    const fixed = await call('POST', '/api/v1/orgs', { token, headers, body: sampleOrg() });
    expect(fixed.status).toBe(201);
  });
});
