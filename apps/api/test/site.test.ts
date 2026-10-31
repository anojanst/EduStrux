import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/env';
import { serveHome } from '../src/site';

// The static assets, as a fake: answers with the path it was asked for.
const assets = () => ({
  fetch: vi.fn(async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return new Response(`asset ${url.pathname}`);
  }),
});
const envWith = (ASSETS?: ReturnType<typeof assets>) => ({ ASSETS }) as unknown as Bindings;

describe('the home page (TUI-76)', () => {
  it('is the marketing page on edustrux.com', async () => {
    const ASSETS = assets();
    const res = await serveHome(new Request('https://edustrux.com/'), envWith(ASSETS));
    expect(await res!.text()).toBe('asset /landing');
  });

  it('sends www to the bare domain', async () => {
    const res = await serveHome(new Request('https://www.edustrux.com/'), envWith(assets()));
    expect(res!.status).toBe(301);
    expect(res!.headers.get('Location')).toBe('https://edustrux.com/');
  });

  it('is the app on app.edustrux.com', async () => {
    const res = await serveHome(new Request('https://app.edustrux.com/'), envWith(assets()));
    expect(await res!.text()).toBe('asset /');
  });

  it('leaves every other path, and anywhere without assets, to the API', () => {
    expect(serveHome(new Request('https://edustrux.com/api/v1/health'), envWith(assets()))).toBe(
      null,
    );
    expect(serveHome(new Request('http://localhost:8787/'), envWith())).toBe(null);
  });
});
