import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { notFound } from '../lib/errors';
import { countRequest } from '../lib/rate-limit';
import { findOrCreateUserInOrg } from '../modules/users/repository';
import { signedInAs } from './auth';

/**
 * Signs the caller in and loads their active membership in the org named by the `orgId` path
 * param, together with the org, in one D1 call (D-099). The org stays on the request, so a
 * service that needs it doesn't read it again.
 *
 * Non-members get 404, the same as a missing org, so we never confirm an org id exists. Each
 * request counts against the user's and the org's rate limits (429, TUI-81).
 */
export const requireOrgMember = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await signedInAs(c);
  const orgId = c.req.param('orgId');
  if (!orgId) throw notFound('Organisation');

  const { user, membership, org } = await findOrCreateUserInOrg(c.var.db, identity, orgId);
  c.set('user', user);
  if (!membership || !org) throw notFound('Organisation');
  // Counted once membership is known, so someone outside the org can't use up its allowance.
  await countRequest(c.env.ORG_RATE_LIMIT, org.id);
  c.set('membership', membership);
  c.set('org', org);
  await next();
});
