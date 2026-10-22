import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { setTokenGetter } from '../src/lib/api';
import { clerk } from './clerk';

type Reply = { status?: number; body?: unknown };
type Handler = (request: { body: unknown; headers: Record<string, string> }) => Reply;

/**
 * Stubs `fetch` with replies keyed by "METHOD /api/v1/path" (query string included). Returns
 * the calls made, so a test can check what was sent.
 */
export function stubApi(replies: Record<string, Reply | Handler>) {
  const calls: { key: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${url}`;
      const headers = (init.headers ?? {}) as Record<string, string>;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ key, body, headers });
      const reply = replies[key];
      if (!reply) throw new Error(`No stubbed reply for ${key}`);
      const { status = 200, body: json } =
        typeof reply === 'function' ? reply({ body, headers }) : reply;
      return new Response(status === 204 ? null : JSON.stringify(json ?? null), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** Shows where the router ended up, for routes a test only checks it reached. */
export function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

/** Renders routes at a path with a fresh query cache, and the token the mock Clerk gives. */
export function renderRoutes(
  routes: RouteObject[],
  path: string,
  wrap?: (n: ReactNode) => ReactNode,
) {
  setTokenGetter(async () => (clerk.signedIn ? 'test-token' : null));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, queryClient, ...render(wrap ? wrap(tree) : tree) };
}
