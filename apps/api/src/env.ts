import type { Db } from '@edustrux/db';
import type { Role, Scope } from '@edustrux/shared';
import type { EmailMessage, JobMessage } from './background/messages';

export type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  EMAIL_QUEUE: Queue<EmailMessage>;
  JOBS_QUEUE: Queue<JobMessage>;
  ENVIRONMENT: 'development' | 'staging' | 'production' | 'test';
  ENABLE_DOCS: string;
  CLERK_AUTHORIZED_PARTIES: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
};

export type AuthUser = {
  id: string;
  clerkUserId: string;
  email: string | null;
  name: string | null;
};

export type ActiveMembership = {
  id: string;
  orgId: string;
  userId: string;
  role: Role;
  branchIds: string[] | null;
};

export type Variables = {
  db: Db;
  /** Set by requireAuth. */
  user: AuthUser;
  /** Set by requireOrgMember, on /orgs/{orgId} routes only. */
  membership: ActiveMembership;
  /** Set by requirePermission: how far this role's permission reaches. */
  scope: Scope;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
