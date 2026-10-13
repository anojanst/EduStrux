import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { notFound } from '../lib/errors';
import { findOrCreateUserInOrg } from '../modules/users/repository';
import { signedInAs } from './auth';

/**
 * Signs the caller in and loads their active membership in the org named by the `orgId` path
 * param, together with the org, in one D1 call (D-099). The org stays on the request, so a
 * service that needs it doesn't read it again.
 *
 * Non-members get 404, the same as a missing org, so we never confirm an org id exists.
 */
export const requireOrgMember = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await signedInAs(c);
  const orgId = c.req.param('orgId');
  if (!orgId) throw notFound('Organisation');

  const { user, membership, org } = await findOrCreateUserInOrg(c.var.db, identity, orgId);
  c.set('user', user);
  if (!membership || !org) throw notFound('Organisation');
  c.set('membership', membership);
  c.set('org', org);
  await next();
});
