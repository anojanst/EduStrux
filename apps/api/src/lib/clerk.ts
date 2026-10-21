// Clerk's Backend API, for what the session token can't do (TUI-75). Plain fetch.
import type { Bindings } from '../env';
import { ApiError, unavailable } from './errors';

const CLERK_API = 'https://api.clerk.com/v1';

/** How long an impersonation link works, and how long the session it opens lasts. */
export const ACTOR_TOKEN_SECONDS = 10 * 60;
export const ACTOR_SESSION_SECONDS = 60 * 60;

/**
 * A one-time link that signs the admin in as the user (Clerk's actor tokens). The session it
 * opens names the admin in its `act` claim, which is how the API logs every request made in it.
 */
export async function createActorToken(
  env: Bindings,
  input: { userClerkId: string; adminClerkId: string },
  fetchFn: typeof fetch = fetch,
) {
  if (!env.CLERK_SECRET_KEY) throw unavailable('Impersonation needs CLERK_SECRET_KEY.');
  const res = await fetchFn(`${CLERK_API}/actor_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: input.userClerkId,
      actor: { sub: input.adminClerkId },
      expires_in_seconds: ACTOR_TOKEN_SECONDS,
      session_max_duration_in_seconds: ACTOR_SESSION_SECONDS,
    }),
  });
  if (!res.ok) {
    console.error(`Clerk actor_tokens answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new ApiError(503, 'unavailable', 'Clerk couldn’t be reached. Please try again.');
  }
  const body = (await res.json()) as { url?: string | null };
  if (!body.url) throw new ApiError(503, 'unavailable', 'Clerk gave no sign-in link.');
  return {
    url: body.url,
    expiresAt: new Date(Date.now() + ACTOR_TOKEN_SECONDS * 1000).toISOString(),
  };
}
