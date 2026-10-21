import { ROLES } from '../permissions';
import { z } from '../zod';
import { Timestamp } from './common';
import { MembershipSummary } from './orgs';

/** Every role but parent: parents are invited through their guardian. */
export const STAFF_ROLES = ROLES.filter((role) => role !== 'parent') as [
  Exclude<(typeof ROLES)[number], 'parent'>,
  ...Exclude<(typeof ROLES)[number], 'parent'>[],
];
export const StaffRole = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRole>;

/** Roles whose reach is the whole org, so a branch list means nothing for them. */
export const ORG_WIDE_ROLES: readonly StaffRole[] = ['owner', 'accountant'];

export const MembershipStatus = z.enum(['active', 'suspended']);

const Email = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase())
  .openapi({ example: 'teacher@example.com' });

const BranchIds = z
  .array(z.string())
  .max(100)
  .nullable()
  .openapi({
    description:
      'Branches the member is limited to. null means every branch. Owners and accountants ' +
      'reach the whole org, so theirs is always null.',
  });

const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});

/** Owners and accountants reach the whole org: a branch list sent with one is 400. */
function noBranchesForOrgWide(
  value: { role?: StaffRole; branchIds?: string[] | null },
  ctx: z.RefinementCtx,
) {
  if (value.role && ORG_WIDE_ROLES.includes(value.role) && value.branchIds) {
    ctx.addIssue({ code: 'custom', path: ['branchIds'], message: 'Not used for this role' });
  }
}

export const StaffMember = z
  .object({
    id: z
      .string()
      .openapi({ example: 'mem_01j9z3k6m2q8w4e5r6t7y8u9i0', description: 'The membership id' }),
    userId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: z.enum(ROLES),
    branchIds: z.array(z.string()).nullable(),
    status: MembershipStatus,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('StaffMember');
export type StaffMember = z.infer<typeof StaffMember>;

export const CreateInvitation = z
  .object({
    email: Email,
    role: StaffRole,
    branchIds: BranchIds.optional(),
  })
  .superRefine(noBranchesForOrgWide)
  .openapi('CreateInvitation');
export type CreateInvitation = z.infer<typeof CreateInvitation>;

export const InviteGuardian = z
  .object({
    email: Email.optional().openapi({
      description: "Where to send the invite. Defaults to the guardian's email.",
    }),
  })
  .openapi('InviteGuardian');
export type InviteGuardian = z.infer<typeof InviteGuardian>;

export const Invitation = z
  .object({
    id: z.string().openapi({ example: 'ivt_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    email: z.string(),
    role: z.enum(ROLES),
    branchIds: z.array(z.string()).nullable(),
    guardianId: z.string().nullable().openapi({
      description: "A parent's invite: the guardian that accepting it signs in as.",
    }),
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .openapi('Invitation');
export type Invitation = z.infer<typeof Invitation>;

export const CreatedInvitation = z
  .object({
    invitation: Invitation,
    token: z.string().openapi({
      description:
        'The secret the invited person accepts with, at POST /api/v1/invitations/{token}/accept. ' +
        'Shown only in this response: share it with them until invite emails are sent.',
    }),
  })
  .openapi('CreatedInvitation');
export type CreatedInvitation = z.infer<typeof CreatedInvitation>;

export const UpdateStaffMember = z
  .object({
    updatedAt: UpdatedAt,
    role: StaffRole,
    branchIds: BranchIds,
    status: MembershipStatus,
  })
  .partial()
  .required({ updatedAt: true })
  .superRefine(noBranchesForOrgWide)
  .openapi('UpdateStaffMember');
export type UpdateStaffMember = z.infer<typeof UpdateStaffMember>;

/** What accepting an invite joins: the membership, as `GET /me` lists it. */
export const AcceptedInvitation = MembershipSummary;
