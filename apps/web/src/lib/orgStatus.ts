import type { Org } from '@edustrux/shared';

export type OrgBanner =
  { kind: 'trial'; daysLeft: number } | { kind: 'readOnly' } | { kind: 'pastDue' } | null;

const DAY = 86_400_000;

/**
 * The banner under the top bar (ui-design.md §6 Banners), from the org's status: trial days left,
 * read-only once the trial ends or the org is suspended or cancelled (D-153), or a payment
 * problem.
 */
export function orgBanner(org: Pick<Org, 'status' | 'trialEndsAt'>, now = new Date()): OrgBanner {
  if (org.status === 'suspended' || org.status === 'cancelled') return { kind: 'readOnly' };
  if (org.status === 'past_due') return { kind: 'pastDue' };
  if (org.status === 'trialing' && org.trialEndsAt) {
    const left = Math.ceil((new Date(org.trialEndsAt).getTime() - now.getTime()) / DAY);
    return left <= 0 ? { kind: 'readOnly' } : { kind: 'trial', daysLeft: left };
  }
  return null;
}
