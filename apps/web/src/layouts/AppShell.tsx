import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronsUpDown,
  House,
  LogOut,
  Menu,
  Plus,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { t, type MessageKey } from '../i18n';
import { cn } from '../lib/cn';
import { useOrg } from '../lib/org';
import { orgBanner } from '../lib/orgStatus';
import { can, roleLabel, type Role } from '../lib/roles';
import { orgPath, rememberOrg } from '../lib/session';

type NavItem = { to: string; label: MessageKey; Icon: LucideIcon; end?: boolean };

/**
 * The nav for a role (ui-design.md §5): only what the role can use. More areas join as their
 * screens are built (TUI-40 onwards).
 */
function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [{ to: '', label: 'nav.home', Icon: House, end: true }];
  if (can(role, 'staff:read')) {
    items.push({ to: 'settings/team', label: 'nav.team', Icon: UsersRound });
  }
  return items;
}

/**
 * The app shell (ui-design.md §5): a teal sidebar on desktop, a top bar with a drawer on smaller
 * screens, and the org's banner above the page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 lg:block">
        <Sidebar />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t('shell.closeMenu')}
            className="absolute inset-0 bg-text/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-pop">
            <Sidebar onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface px-2 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('shell.openMenu')}
            onClick={() => setDrawerOpen(true)}
            icon={<Menu className="size-5 text-text" />}
          />
          <Logo />
        </header>
        <OrgBanner />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return (
    <nav
      aria-label={t('shell.nav')}
      className="flex h-full flex-col gap-6 overflow-y-auto bg-sidebar px-4 py-5 text-sidebar-text"
    >
      <div className="flex items-center justify-between">
        <Logo inverted />
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shell.closeMenu')}
            className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-sidebar-raised"
          >
            <X className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>
      <OrgSwitcher />
      <ul className="flex flex-col gap-1">
        {navFor(membership.role).map(({ to, label, Icon, end }) => (
          <li key={label}>
            <NavLink
              to={to ? `${base}/${to}` : base}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-lg px-3 text-label font-medium transition-colors duration-150',
                  isActive ? 'bg-white text-brand' : 'hover:bg-sidebar-raised hover:text-white',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <UserFooter />
      </div>
    </nav>
  );
}

/** The org card in the sidebar; with more than one org it opens the list of them. */
function OrgSwitcher() {
  const { me, membership } = useOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = me.memberships.length > 1;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !ref.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const card = (
    <>
      <Avatar name={membership.org.name} tone="org" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-meta font-semibold tracking-[0.05em] text-sidebar-text uppercase">
          {t('shell.organisation')}
        </span>
        <span className="block truncate text-body font-semibold text-white">
          {membership.org.name}
        </span>
      </span>
    </>
  );

  return (
    <div ref={ref} className="relative">
      {others ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-xl bg-sidebar-raised p-3 transition-colors duration-150 hover:bg-sidebar-raised/80"
        >
          {card}
          <ChevronsUpDown className="size-4 shrink-0" aria-hidden />
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-sidebar-raised p-3">{card}</div>
      )}
      {open ? (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-50 mt-2 rounded-xl border border-border bg-surface p-1 text-text shadow-pop"
        >
          {me.memberships.map((m) => (
            <Link
              key={m.id}
              role="menuitem"
              to={orgPath(m.org.slug)}
              onClick={() => {
                rememberOrg(m.org.slug);
                setOpen(false);
              }}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas"
            >
              <Avatar name={m.org.name} tone="org" className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold">{m.org.name}</span>
                <span className="block text-meta text-muted">{roleLabel(m.role)}</span>
              </span>
              {m.id === membership.id ? (
                <Check className="size-4 text-brand" aria-label={t('shell.current')} />
              ) : null}
            </Link>
          ))}
          <Link
            role="menuitem"
            to="/onboarding"
            className="mt-1 flex items-center gap-3 rounded-lg border-t border-border px-2 py-2 text-label font-medium text-brand hover:bg-canvas"
          >
            <Plus className="size-4" aria-hidden />
            {t('orgs.startAnother')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function UserFooter() {
  const { me, membership } = useOrg();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const name = me.name ?? me.email;
  return (
    <div className="flex items-center gap-3 rounded-xl px-1 py-2">
      <Avatar name={me.name} fallback={me.email ?? '?'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-semibold text-white">{name}</span>
        <span className="block text-meta">{roleLabel(membership.role)}</span>
      </span>
      <button
        type="button"
        aria-label={t('common.signOut')}
        title={t('common.signOut')}
        onClick={() => {
          queryClient.clear();
          void signOut();
        }}
        className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-sidebar-raised hover:text-white lg:size-9"
      >
        <LogOut className="size-5" aria-hidden />
      </button>
    </div>
  );
}

const TRIAL_DISMISSED = 'edustrux.trialBannerDismissed';

/** Trial days left, read-only, or a payment problem (ui-design.md §6 Banners). */
function OrgBanner() {
  const { org, membership } = useOrg();
  const today = new Date().toISOString().slice(0, 10);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(TRIAL_DISMISSED) === today;
    } catch {
      return false;
    }
  });
  if (!org) return null;
  const banner = orgBanner(org);
  if (!banner) return null;

  const owner = membership.role === 'owner';
  if (banner.kind === 'trial') {
    if (dismissed) return null;
    return (
      <div className="flex items-center gap-3 border-b border-border bg-warning-soft px-4 py-2.5 text-body text-text sm:px-8">
        <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="flex-1">
          {t(banner.daysLeft === 1 ? 'banner.trialOne' : 'banner.trial', { days: banner.daysLeft })}
        </p>
        <button
          type="button"
          aria-label={t('common.dismiss')}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(TRIAL_DISMISSED, today);
            } catch {
              // Not remembered; it shows again on the next visit.
            }
          }}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-white/60"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }
  const readOnly = banner.kind === 'readOnly';
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 border-b border-border px-4 py-2.5 text-body text-text sm:px-8',
        readOnly ? 'bg-danger-soft' : 'bg-warning-soft',
      )}
    >
      <TriangleAlert
        className={cn('size-4 shrink-0', readOnly ? 'text-danger' : 'text-warning')}
        aria-hidden
      />
      <p className="flex-1">
        {readOnly
          ? t(owner ? 'banner.readOnlyOwner' : 'banner.readOnly')
          : t(owner ? 'banner.pastDueOwner' : 'banner.pastDue')}
      </p>
    </div>
  );
}
