import { ROLES } from '@edustrux/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { now, orgColumns, timestamps } from '../columns';

// The only table without org_id: a person can belong to several orgs.
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    clerkUserId: text('clerk_user_id').notNull(),
    email: text('email'),
    name: text('name'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_clerk_user_id_uq').on(t.clerkUserId)],
);

export const orgs = sqliteTable(
  'orgs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    country: text('country'),
    currency: text('currency').notNull(),
    timezone: text('timezone').notNull(),
    locale: text('locale').notNull(),
    dateFormat: text('date_format', { enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] }).notNull(),
    singleTutorMode: integer('single_tutor_mode', { mode: 'boolean' }).notNull().default(false),
    brandColor: text('brand_color'),
    taxNumber: text('tax_number'),
    plan: text('plan', { enum: ['trial', 'solo', 'small', 'custom'] })
      .notNull()
      .default('trial'),
    status: text('status', {
      enum: ['trialing', 'active', 'past_due', 'suspended', 'cancelled'],
    })
      .notNull()
      .default('trialing'),
    trialEndsAt: text('trial_ends_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('orgs_slug_uq').on(t.slug)],
);

export const memberships = sqliteTable(
  'memberships',
  {
    ...orgColumns(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    // JSON array of branch ids; null = all branches.
    branchIds: text('branch_ids', { mode: 'json' }).$type<string[] | null>(),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
  },
  (t) => [
    uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invitations = sqliteTable(
  'invitations',
  {
    ...orgColumns(),
    email: text('email').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    branchIds: text('branch_ids', { mode: 'json' }).$type<string[] | null>(),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
  },
  (t) => [
    index('invitations_org_email_idx').on(t.orgId, t.email),
    uniqueIndex('invitations_token_hash_uq').on(t.tokenHash),
  ],
);

// Append-only, so no updated_at / deleted_at.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: text('before', { mode: 'json' }),
    after: text('after', { mode: 'json' }),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('audit_log_org_id_idx').on(t.orgId, t.id),
    index('audit_log_org_entity_idx').on(t.orgId, t.entityType, t.entityId),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    ...orgColumns(),
    type: text('type').notNull(),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] })
      .notNull()
      .default('queued'),
    progress: integer('progress').notNull().default(0),
    // Queue deliveries so far (Cloudflare's message.attempts), including the one running now.
    attempts: integer('attempts').notNull().default(0),
    input: text('input', { mode: 'json' }),
    result: text('result', { mode: 'json' }),
    error: text('error'),
    createdByUserId: text('created_by_user_id'),
  },
  (t) => [index('jobs_org_status_idx').on(t.orgId, t.status)],
);

// Stored responses for requests sent with an Idempotency-Key header.
// `scope` is the org id for org routes, or the user id for routes outside an org
// (e.g. POST /orgs), so this table carries scope instead of org_id.
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseBody: text('response_body'),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('idempotency_keys_scope_key_uq').on(t.scope, t.key)],
);
