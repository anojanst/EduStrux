import type { Me, Org } from '@edustrux/shared';
import { createContext, useContext } from 'react';
import type { Membership } from './session';

export type OrgContextValue = {
  me: Me;
  membership: Membership;
  /** The org's settings (`GET /orgs/{orgId}`); undefined while it loads. */
  org: Org | undefined;
};

export const OrgContext = createContext<OrgContextValue | null>(null);

/** The org the current page is in, and the user's membership of it. Inside `/o/:orgSlug`. */
export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg is only for pages inside /o/:orgSlug');
  return value;
}

/** `/api/v1/orgs/{orgId}` + path: every org route's prefix. */
export function orgApiPath(membership: Membership, path = '') {
  return `/orgs/${membership.org.id}${path}`;
}
