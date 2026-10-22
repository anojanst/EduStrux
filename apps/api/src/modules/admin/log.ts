import { newId } from '@edustrux/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../../env';
import * as repo from './repository';

// The super-admin access log (TUI-75). Written before the request does anything, so a request
// that then fails is still on record.

/** The org a request is for, from its path. */
const orgOf = (path: string) =>
  path.match(/^\/api\/v1\/(?:admin\/)?orgs\/(org_[a-z0-9]+)/)?.[1] ?? null;

async function log(
  c: Context<AppEnv>,
  entry: {
    action: string;
    adminClerkUserId: string;
    adminUserId?: string | null;
    detail?: unknown;
  },
) {
  const url = new URL(c.req.url);
  await repo.logAccess(c.var.db, {
    id: newId('adminAccess'),
    adminClerkUserId: entry.adminClerkUserId,
    adminUserId: entry.adminUserId ?? null,
    action: entry.action,
    orgId: orgOf(url.pathname),
    method: c.req.method,
    path: url.pathname + url.search,
    detail: entry.detail ?? null,
  });
}

/** A request made while a super-admin is signed in as someone else. */
export function logImpersonated(c: Context<AppEnv>, adminClerkUserId: string) {
  return log(c, { action: 'impersonated.request', adminClerkUserId });
}

/** A request to an admin route, or what it did. */
export function logAdmin(
  c: Context<AppEnv>,
  action: string,
  admin: { clerkUserId: string; id: string },
  detail?: unknown,
) {
  return log(c, { action, adminClerkUserId: admin.clerkUserId, adminUserId: admin.id, detail });
}
