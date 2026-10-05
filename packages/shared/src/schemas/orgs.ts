import { ROLES } from '../permissions';
import { z } from '../zod';
import { CurrencyCode, Locale, Timestamp, TimeZone } from './common';

export const OrgPlan = z.enum(['trial', 'solo', 'small', 'custom']);
export const OrgStatus = z.enum(['trialing', 'active', 'past_due', 'suspended', 'cancelled']);
export const DateFormat = z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
export type DateFormat = z.infer<typeof DateFormat>;

const Slug = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only')
  .openapi({ example: 'bright-minds' });

export const Org = z
  .object({
    id: z.string().openapi({ example: 'org_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    slug: Slug,
    country: z.string().length(2).nullable(),
    currency: CurrencyCode,
    timezone: TimeZone,
    locale: Locale,
    dateFormat: DateFormat,
    singleTutorMode: z.boolean(),
    brandColor: z.string().nullable(),
    taxNumber: z.string().nullable(),
    plan: OrgPlan,
    status: OrgStatus,
    trialEndsAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Org');
export type Org = z.infer<typeof Org>;

export const CreateOrg = z
  .object({
    name: z.string().trim().min(2).max(120).openapi({ example: 'Bright Minds Tuition' }),
    slug: Slug.optional(),
    country: z
      .string()
      .length(2)
      .toUpperCase()
      .optional()
      .openapi({ example: 'NZ', description: 'ISO 3166-1 alpha-2' }),
    currency: CurrencyCode,
    timezone: TimeZone,
    locale: Locale,
    dateFormat: DateFormat.default('DD/MM/YYYY'),
    singleTutorMode: z.boolean().default(false),
  })
  .openapi('CreateOrg');
export type CreateOrg = z.infer<typeof CreateOrg>;

export const UpdateOrg = z
  .object({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
    name: z.string().trim().min(2).max(120),
    slug: Slug,
    country: z.string().length(2).toUpperCase().nullable(),
    currency: CurrencyCode,
    timezone: TimeZone,
    locale: Locale,
    dateFormat: DateFormat,
    singleTutorMode: z.boolean(),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    taxNumber: z.string().trim().max(40).nullable(),
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateOrg');
export type UpdateOrg = z.infer<typeof UpdateOrg>;

export const RoleEnum = z.enum(ROLES);

export const MembershipSummary = z
  .object({
    id: z.string(),
    role: RoleEnum,
    branchIds: z.array(z.string()).nullable().openapi({
      description: 'Branches this membership is limited to. null means all branches.',
    }),
    org: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  })
  .openapi('MembershipSummary');

export const Me = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    memberships: z.array(MembershipSummary),
  })
  .openapi('Me');
export type Me = z.infer<typeof Me>;
