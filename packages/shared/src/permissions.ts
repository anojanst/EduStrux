// Roles live in our database (memberships.role), not in Clerk.
// Each route declares one permission; the role decides whether it's allowed and at what scope.

export const ROLES = [
  'owner',
  'branch_manager',
  'front_desk',
  'teacher',
  'parent',
  'accountant',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * - all:    every record in the org
 * - branch: only records in the membership's branches
 * - own:    only the teacher's own classes, or the parent's own family
 */
export type Scope = 'all' | 'branch' | 'own';

export const PERMISSIONS = [
  'org:read',
  'org:write',
  'staff:read',
  'staff:write',
  'people:read',
  'people:write',
  'classes:read',
  'classes:write',
  'attendance:read',
  'attendance:write',
  'absences:report',
  'billing:read',
  'billing:write',
  'billing:export',
  'messages:read',
  'messages:write',
  'reports:read',
  'reports:money',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const owner = Object.fromEntries(PERMISSIONS.map((p) => [p, 'all'])) as Record<Permission, Scope>;

// Mirrors the roles table in the handoff (§6).
export const ROLE_PERMISSIONS: Record<Role, Partial<Record<Permission, Scope>>> = {
  owner,
  branch_manager: {
    'org:read': 'all',
    'staff:read': 'branch',
    'staff:write': 'branch',
    'people:read': 'branch',
    'people:write': 'branch',
    'classes:read': 'branch',
    'classes:write': 'branch',
    'attendance:read': 'branch',
    'attendance:write': 'branch',
    'billing:read': 'branch',
    'billing:write': 'branch',
    'messages:read': 'branch',
    'messages:write': 'branch',
    'reports:read': 'branch',
    'reports:money': 'branch',
  },
  front_desk: {
    'org:read': 'all',
    'people:read': 'branch',
    'people:write': 'branch',
    'classes:read': 'branch',
    'classes:write': 'branch',
    'attendance:read': 'branch',
    'attendance:write': 'branch',
    'billing:read': 'branch',
    'billing:write': 'branch',
    'messages:read': 'branch',
    'messages:write': 'branch',
    'reports:read': 'branch',
  },
  teacher: {
    'org:read': 'all',
    'people:read': 'own',
    'classes:read': 'own',
    'attendance:read': 'own',
    'attendance:write': 'own',
    'messages:read': 'own',
    'messages:write': 'own',
    'reports:read': 'own',
  },
  parent: {
    'org:read': 'all',
    'people:read': 'own',
    'classes:read': 'own',
    'attendance:read': 'own',
    'absences:report': 'own',
    'billing:read': 'own',
    'messages:read': 'own',
  },
  accountant: {
    'org:read': 'all',
    'billing:read': 'all',
    'billing:export': 'all',
    'reports:money': 'all',
  },
};

export function scopeFor(role: Role, permission: Permission): Scope | null {
  return ROLE_PERMISSIONS[role][permission] ?? null;
}
