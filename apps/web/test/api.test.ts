import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, fieldErrors, setTokenGetter } from '../src/lib/api';
import { stubApi } from './render';

afterEach(() => setTokenGetter(async () => null));

describe('api()', () => {
  it('sends the Clerk token as a Bearer header, and JSON bodies', async () => {
    setTokenGetter(async () => 'tok');
    const calls = stubApi({ 'POST /api/v1/orgs': { status: 201, body: { id: 'org_1' } } });
    expect(await api('POST', '/orgs', { body: { name: 'A' } })).toEqual({ id: 'org_1' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual({ name: 'A' });
  });

  it('sends no token when asked not to', async () => {
    setTokenGetter(async () => 'tok');
    const calls = stubApi({ 'GET /api/v1/invitations/x': { body: {} } });
    await api('GET', '/invitations/x', { auth: false });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('turns an error answer into an ApiError with its code and fields', async () => {
    stubApi({
      'POST /api/v1/orgs': {
        status: 400,
        body: {
          error: { code: 'validation_failed', message: 'Bad', fields: { name: ['Too short'] } },
        },
      },
    });
    const error = await api('POST', '/orgs', { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(fieldErrors(error)).toEqual({ name: 'Too short' });
  });

  it('answers 204 with nothing, and a failed connection as a network error', async () => {
    stubApi({ 'DELETE /api/v1/x': { status: 204 } });
    expect(await api('DELETE', '/x')).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api('GET', '/me')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
