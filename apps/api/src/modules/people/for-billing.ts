import type { Access, OrgCtx } from '../../db/scope';
import * as repo from './repository';

// What billing asks of people that the people service doesn't offer (TUI-97). It names only
// people's own tables, through people's repository (D-104).

/**
 * Whether the org has this family and the caller may see it: the check `getFamily` makes, for a
 * caller that filters by the family and shows nothing of it. One statement on the family's own
 * row, where `getFamily` also loads its guardians, students and grades.
 *
 * The reach is the one the people service gives the roles that read invoices: staff by the
 * family's home branch, a parent by being its guardian. A teacher reads no invoices (D-096) and
 * is treated here as a guardian, so one finds nothing.
 */
export async function familyWithinReach(ctx: OrgCtx, access: Access, id: string) {
  return (await repo.findFamily(ctx, id, billingReach(access))) !== undefined;
}

/**
 * What a payment shows of its family, if the org has the family and the caller may see it: the
 * check `familyWithinReach` makes, in the same one statement.
 */
export async function familyLabelWithinReach(ctx: OrgCtx, access: Access, id: string) {
  const row = await repo.findFamily(ctx, id, billingReach(access));
  return row && { name: row.name, branchId: row.branchId };
}

function billingReach(access: Access): repo.Reach {
  if (access.scope === 'own') return { guardianMembershipId: access.membershipId };
  return access.scope === 'branch' && access.branchIds ? { branchIds: access.branchIds } : {};
}
