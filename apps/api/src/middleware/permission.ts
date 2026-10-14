import { scopeFor, type Permission, type Role } from '@edustrux/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { forbidden } from '../lib/errors';
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
export function orgAccess(permission: Permission) {
  return [requireOrgMember, requirePermission(permission)];
}

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
