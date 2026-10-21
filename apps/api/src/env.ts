import type { Db, orgs } from '@edustrux/db';
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
  /** Resend's API key, a secret the owner sets. Without it (or EMAIL_FROM) no email is sent. */
  RESEND_API_KEY?: string;
  /** The sender of every email, `Name <address>`, on a domain verified with Resend. */
  EMAIL_FROM?: string;
  /** The web app's address, for links in emails. Without it, emails carry codes, not links. */
  APP_URL?: string;
  /**
   * Cloudflare Browser Rendering's REST API, which turns invoice and receipt HTML into PDFs
   * (D-025): the account id, and an API token with Browser Rendering: Edit. Secrets the owner
   * sets. Without them a PDF is 503, and `?format=html` still gives the printable page.
   */
  BROWSER_RENDERING_ACCOUNT_ID?: string;
  BROWSER_RENDERING_TOKEN?: string;
  /**
   * Cloudflare Turnstile's secret, for the public forms (TUI-47). With it, a form must carry a
   * valid `turnstileToken`; without it, only the hidden field and the hourly limit guard them.
   */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Signs the short-lived links files are uploaded and downloaded through (TUI-61). A secret the
   * owner sets: any long random string. Without it, files can't be uploaded or fetched (503).
   */
  FILES_SIGNING_SECRET?: string;
  /**
   * The signing secrets (`whsec_…`) of the Clerk and Resend webhooks (TUI-71), from each
   * dashboard's webhook endpoint. Without one, that webhook answers 503 and the sender retries.
   */
  CLERK_WEBHOOK_SECRET?: string;
  RESEND_WEBHOOK_SECRET?: string;
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

/** The org as stored. */
export type OrgRow = typeof orgs.$inferSelect;

export type Variables = {
  db: Db;
  /** Set by requireAuth, and by requireOrgMember on /orgs/{orgId} routes. */
  user: AuthUser;
  /** Set by requireOrgMember, on /orgs/{orgId} routes only. */
  membership: ActiveMembership;
  /** Set by requireOrgMember with the membership: the org, as it was when the request began. */
  org: OrgRow;
  /** Set by requirePermission: how far this role's permission reaches. */
  scope: Scope;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
