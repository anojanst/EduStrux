import { scopeFor, type Permission } from '@edustrux/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { forbidden } from '../lib/errors';
import { requireAuth } from './auth';
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
 * Clerk token → org membership (404 if none) → the route's one permission (403 if denied).
 */
export function orgAccess(permission: Permission) {
  return [requireAuth, requireOrgMember, requirePermission(permission)];
}
