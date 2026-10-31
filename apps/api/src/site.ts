import type { Bindings } from './env';

/** Where the marketing page lives (TUI-76). The app itself is on app.edustrux.com (D-196). */
const SITE_HOST = 'edustrux.com';

/**
 * The home page, "/", which the Worker sees first (`run_worker_first` under `env.production`):
 * the marketing page on edustrux.com, www sent there, and the app's own page on any other host.
 * Null for any other path, and wherever there are no static assets (locally and in tests), so
 * the API handles it.
 */
export function serveHome(request: Request, env: Bindings): Promise<Response> | Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/' || !env.ASSETS) return null;
  if (url.hostname === `www.${SITE_HOST}`) return Response.redirect(`https://${SITE_HOST}/`, 301);
  // `/landing`, not `/landing.html`: the assets answer the .html name with a redirect to it.
  if (url.hostname === SITE_HOST) return env.ASSETS.fetch(new URL('/landing', url));
  return env.ASSETS.fetch(request);
}
