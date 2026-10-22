import { orgCanWrite, scopeFor, type Permission, type Role } from '@edustrux/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { forbidden, subscriptionRequired } from '../lib/errors';
import { requireOrgMember } from './org';

export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const scope = scopeFor(c.var.membership.role, permission);
    if (!scope) throw forbidden();
    c.set('scope', scope);
    await next();
  });
}

/**
 * The middleware chain for every `/orgs/{orgId}/...` route:
 * Clerk token (401) → org membership (404 if none) → the route's one permission (403 if denied).
 * The first two are one middleware, so they cost one D1 call between them (D-099).
 */
export function orgAccess(permission: Permission, options: { whileReadOnly?: boolean } = {}) {
  return options.whileReadOnly
    ? [requireOrgMember, requirePermission(permission)]
    : [requireOrgMember, requirePermission(permission), requireWritable];
}

/**
 * A change to an org that is read-only (its trial ended with no subscription, or it is suspended
 * or cancelled) is 402, after the permission check. Reads go through, and so do the few writes
 * marked `whileReadOnly`: subscribing and exporting (TUI-74).
 */
const requireWritable = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && !orgCanWrite(c.var.org)) {
    throw subscriptionRequired();
  }
  await next();
});

/**
 * `orgAccess` for a route only one role uses, such as the parent portal: every other role gets
 * 403, whatever its permissions (D-126). It reads nothing more.
 */
export function roleAccess(role: Role, permission: Permission) {
  const onlyRole = createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.membership.role !== role) throw forbidden();
    await next();
  });
  return [...orgAccess(permission), onlyRole];
}
