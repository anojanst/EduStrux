import { RateLimited } from './errors';

// Requests per signed-in user and per org (TUI-81, D-191), with Workers rate limiters bound in
// production. A limiter counts in each Cloudflare location separately and is approximate: it's
// there to stop a runaway script or a stolen session, not to meter normal use. The public forms
// have their own limit (D-144).

/** The window both limiters count over, in seconds: what `Retry-After` says. */
export const RATE_LIMIT_PERIOD = 60;

/**
 * Counts one request against `key`, and throws 429 once the limiter says it's over. Without a
 * limiter (locally, in tests) nothing is counted. A limiter that fails lets the request through:
 * an outage there shouldn't take the API down.
 */
export async function countRequest(limiter: RateLimit | undefined, key: string) {
  if (!limiter) return;
  let success: boolean;
  try {
    ({ success } = await limiter.limit({ key }));
  } catch (err) {
    console.error('rate limiter failed; the request goes through', err);
    return;
  }
  if (!success) {
    throw new RateLimited(RATE_LIMIT_PERIOD, 'Too many requests. Try again in a minute.');
  }
}
