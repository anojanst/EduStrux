import { useAuth } from '@clerk/react';
import type { Me } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Membership = Me['memberships'][number];

export const meKey = ['me'] as const;

/** The signed-in user and their memberships, from `GET /me`. Off while signed out. */
export function useMe() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => api<Me>('GET', '/me', { signal }),
    enabled: isSignedIn === true,
    staleTime: 60_000,
  });
}

const LAST_ORG = 'edustrux.lastOrg';

/** Remembers the org last opened, so the next visit goes straight there. */
export function rememberOrg(slug: string) {
  try {
    localStorage.setItem(LAST_ORG, slug);
  } catch {
    // Storage can be blocked (private mode); the org picker still works without it.
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG);
  } catch {
    return null;
  }
}

export const orgPath = (slug: string) => `/o/${slug}`;

/**
 * Where a signed-in user starts: no membership → the welcome page (start a centre, or use an
 * invite); one → that org; several → the one opened last, else the picker.
 */
export function landingPath(memberships: Membership[], last: string | null): string {
  if (memberships.length === 0) return '/welcome';
  if (memberships.length === 1) return orgPath(memberships[0]!.org.slug);
  const remembered = memberships.find((m) => m.org.slug === last);
  return remembered ? orgPath(remembered.org.slug) : '/orgs';
}

/**
 * Only paths inside the app are followed after sign-in, so a crafted `redirect_url` can't send
 * someone to another site.
 */
export function safeRedirect(target: string | null): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return null;
  return target;
}
