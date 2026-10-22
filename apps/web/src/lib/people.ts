import type { AcademicYear, Branch, Family, GradeLevel, Guardian } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { orgApiPath, useOrg } from './org';
import { orgPath } from './session';

export type Page<T> = { data: T[]; nextCursor: string | null };

/** `?a=1&b=2` from the values that are set. */
export function query(params: Record<string, string | number | null | undefined>) {
  const parts = Object.entries(params).flatMap(([key, value]) =>
    value === undefined || value === null || value === ''
      ? []
      : [`${key}=${encodeURIComponent(String(value))}`],
  );
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Lists the pages read often and change rarely: branches, grade levels, academic years. */
function useOrgList<T>(name: string, path: string, enabled = true) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: [name, membership.org.id],
    queryFn: ({ signal }) => api<Page<T>>('GET', orgApiPath(membership, path), { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useBranches() {
  return useOrgList<Branch>('branches', '/branches?limit=200');
}

/** In grade order: the API returns the whole list (D-035). */
export function useGradeLevels() {
  return useOrgList<GradeLevel>('grade-levels', '/grade-levels');
}

export function useAcademicYears() {
  return useOrgList<AcademicYear>('academic-years', '/academic-years?limit=200');
}

/** A lookup from id to name; empty while the list loads. */
export function namesOf(list: { id: string; name: string }[] | undefined) {
  const names = new Map(list?.map((item) => [item.id, item.name]));
  return (id: string | null | undefined) => (id ? (names.get(id) ?? '') : '');
}

/** Where the people pages live in this org. */
export function usePeoplePaths() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return {
    list: `${base}/families`,
    students: `${base}/families?tab=students`,
    family: (id: string) => `${base}/families/${id}`,
    student: (id: string) => `${base}/students/${id}`,
  };
}

export const familyKey = (orgId: string, familyId: string) => ['family', orgId, familyId];
export const studentKey = (orgId: string, studentId: string) => ['student', orgId, studentId];

/** Everything under the people area, to refresh after a change. */
export const peopleKeys = (orgId: string) => [
  ['families', orgId],
  ['students', orgId],
  ['family', orgId],
  ['student', orgId],
  ['consents', orgId],
  ['search', orgId],
];

export function guardianName(guardian: Pick<Guardian, 'firstName' | 'lastName'>) {
  return `${guardian.firstName} ${guardian.lastName}`;
}

/** The guardian invoices go to, or the first one. */
export function mainContact(family: Family): Guardian | undefined {
  return family.guardians.find((g) => g.id === family.billingGuardianId) ?? family.guardians[0];
}

/** Whether anyone in the family signs in to the parent portal. */
export function portalSignedIn(family: Family) {
  return family.guardians.some((g) => g.membershipId !== null);
}

/** The fixed class palette (ui-design.md §2), chosen by class id so a class keeps its colour. */
const CLASS_COLOURS = [
  '#5b6ac4',
  '#d4843b',
  '#3f9b6e',
  '#c4566e',
  '#3a8bc4',
  '#8a5bc4',
  '#2f9a94',
  '#6b7a86',
];

export function classColour(classId: string) {
  let hash = 0;
  for (const char of classId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CLASS_COLOURS[hash % CLASS_COLOURS.length]!;
}
