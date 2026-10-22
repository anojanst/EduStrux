import { z } from '../zod';
import { PageQuery, Timestamp } from './common';
import { Org, OrgPlan, OrgStatus } from './orgs';
import { BillingOverview } from './subscriptions';

// The super-admin console (TUI-75): every org, outside the org routes.

export const AdminOrgOwner = z
  .object({ userId: z.string(), name: z.string().nullable(), email: z.string().nullable() })
  .openapi('AdminOrgOwner');

export const AdminOrg = Org.extend({
  owners: z.array(AdminOrgOwner),
}).openapi('AdminOrg');
export type AdminOrg = z.infer<typeof AdminOrg>;

export const AdminOrgDetail = AdminOrg.extend({
  billing: BillingOverview,
  members: z.number().int().openapi({ description: 'Active memberships, parents included.' }),
  families: z.number().int(),
  students: z.number().int(),
}).openapi('AdminOrgDetail');
export type AdminOrgDetail = z.infer<typeof AdminOrgDetail>;

export const AdminOrgQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(100).optional().openapi({
    description: 'The start of the org’s name or slug, ignoring case.',
  }),
  status: OrgStatus.optional(),
});

export const UpdateAdminOrg = z
  .object({
    updatedAt: Timestamp,
    plan: OrgPlan.optional(),
    status: OrgStatus.optional(),
    trialEndsAt: Timestamp.nullable().optional().openapi({
      description: 'To lengthen or end a trial.',
    }),
  })
  .openapi('UpdateAdminOrg');
export type UpdateAdminOrg = z.infer<typeof UpdateAdminOrg>;

export const Impersonate = z
  .object({
    userId: z.string().optional().openapi({
      description: 'The member to sign in as. Defaults to the org’s first owner.',
    }),
    reason: z.string().trim().min(3).max(500).openapi({
      description: 'Why, for the log the org’s owner can see.',
    }),
  })
  .openapi('Impersonate');
export type Impersonate = z.infer<typeof Impersonate>;

export const ImpersonationLink = z
  .object({
    url: z.string().openapi({ description: 'Opens a Clerk session as the member. Use it once.' }),
    userId: z.string(),
    expiresAt: Timestamp,
  })
  .openapi('ImpersonationLink');
