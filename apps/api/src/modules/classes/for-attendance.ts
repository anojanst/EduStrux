import { sessions } from '@edustrux/db';
import { eq } from 'drizzle-orm';
import { idsFrom, type IdQuery, type OrgCtx } from '../../db/scope';

// What attendance asks of classes so that it can read a session and its roster in one stage
// (TUI-89). It is in a file of its own only because this module's service and repository were
// being rewritten by another task at the same time. Once both have merged, fold it in: the
// query into repository.ts, and `classOfSession` into service.ts beside `classesTaughtBy`.

/**
 * The class a session belongs to, as ids to filter another table by: no database trip (D-104).
 * It says nothing about who may see the session. A caller that reads through it also reads the
 * session with `getSession`, and uses nothing it found when that answers 404.
 */
export function classOfSession(ctx: OrgCtx, sessionId: string): IdQuery {
  return idsFrom(ctx, sessions, sessions.classId, eq(sessions.id, sessionId));
}
