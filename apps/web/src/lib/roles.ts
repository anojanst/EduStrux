import { ROLE_PERMISSIONS, type Permission, type Role } from '@edustrux/shared/permissions';
import { t, type MessageKey } from '../i18n';

export type { Role };

export function roleLabel(role: Role) {
  return t(`role.${role}` as MessageKey);
}

/** Whether the role holds the permission at any scope (ui-design.md §1: hide what it can't do). */
export function can(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role][permission] !== undefined;
}

/** Owners and accountants reach the whole org: an invite for them takes no branch list. */
export const ORG_WIDE_ROLES: readonly Role[] = ['owner', 'accountant'];

/**
 * The roles a member may invite (handoff §6, D-131): the owner any staff role, a branch manager
 * only branch managers, front desk and teachers, and with branches of their own when they are
 * limited to some. Parents are invited through their guardian, not here.
 */
export function invitableRoles(inviter: Role): Role[] {
  if (inviter === 'owner')
    return ['owner', 'branch_manager', 'front_desk', 'teacher', 'accountant'];
  if (inviter === 'branch_manager') return ['branch_manager', 'front_desk', 'teacher'];
  return [];
}
