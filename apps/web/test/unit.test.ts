import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { t } from '../src/i18n';
import { orgBanner } from '../src/lib/orgStatus';
import { invitableRoles } from '../src/lib/roles';
import { landingPath, safeRedirect, type Membership } from '../src/lib/session';

const member = (slug: string): Membership => ({
  id: `mem_${slug}`,
  role: 'owner',
  branchIds: null,
  org: { id: `org_${slug}`, name: slug, slug },
});

describe('t()', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(t('invite.title', { org: 'Bright Minds' })).toBe('Join Bright Minds');
    expect(t('invite.title')).toBe('Join {org}');
  });

  it('has no empty message', () => {
    expect(Object.entries(en).filter(([, message]) => message.trim() === '')).toEqual([]);
  });
});

describe('landingPath', () => {
  it('sends someone with no org to the welcome page', () => {
    expect(landingPath([], null)).toBe('/welcome');
  });

  it('opens the only org, or the one opened last, else the picker', () => {
    expect(landingPath([member('a')], null)).toBe('/o/a');
    expect(landingPath([member('a'), member('b')], 'b')).toBe('/o/b');
    expect(landingPath([member('a'), member('b')], 'gone')).toBe('/orgs');
    expect(landingPath([member('a'), member('b')], null)).toBe('/orgs');
  });
});

describe('safeRedirect', () => {
  it('follows only paths inside the app', () => {
    expect(safeRedirect('/invitations/abc')).toBe('/invitations/abc');
    expect(safeRedirect('https://evil.example')).toBeNull();
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect(null)).toBeNull();
  });
});

describe('orgBanner', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  it('counts trial days left, and is read-only once the trial is over', () => {
    expect(orgBanner({ status: 'trialing', trialEndsAt: '2026-10-25T00:00:00Z' }, now)).toEqual({
      kind: 'trial',
      daysLeft: 3,
    });
    expect(orgBanner({ status: 'trialing', trialEndsAt: '2026-10-21T00:00:00Z' }, now)).toEqual({
      kind: 'readOnly',
    });
  });

  it('is read-only when suspended or cancelled, a warning when past due, else none', () => {
    expect(orgBanner({ status: 'suspended', trialEndsAt: null }, now)).toEqual({
      kind: 'readOnly',
    });
    expect(orgBanner({ status: 'cancelled', trialEndsAt: null }, now)).toEqual({
      kind: 'readOnly',
    });
    expect(orgBanner({ status: 'past_due', trialEndsAt: null }, now)).toEqual({ kind: 'pastDue' });
    expect(orgBanner({ status: 'active', trialEndsAt: null }, now)).toBeNull();
  });
});

describe('invitableRoles', () => {
  it('matches the API: owners give any staff role, branch managers three, others none', () => {
    expect(invitableRoles('owner')).toEqual([
      'owner',
      'branch_manager',
      'front_desk',
      'teacher',
      'accountant',
    ]);
    expect(invitableRoles('branch_manager')).toEqual(['branch_manager', 'front_desk', 'teacher']);
    expect(invitableRoles('front_desk')).toEqual([]);
    expect(invitableRoles('parent')).toEqual([]);
  });
});
