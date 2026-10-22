import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronsUpDown,
  House,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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

const COLLAPSED = 'edustrux.sidebarCollapsed';

/** Whether the desktop sidebar is the narrow icon rail, remembered on this browser. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED, value ? '0' : '1');
      } catch {
        // Not remembered; it opens expanded next time.
      }
      return !value;
    });
  return [collapsed, toggle] as const;
}

/**
 * The app shell (ui-design.md §5): a teal sidebar on desktop that collapses to a 72px icon rail,
 * a top bar with a drawer on smaller screens, and the org's banner above the page. The page fills
 * the width beside the sidebar, edge to edge; a page that needs a narrower column sets its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed();
  const location = useLocation();
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      <aside
        className={cn(
          'sticky top-0 z-20 hidden h-dvh shrink-0 transition-[width] duration-150 ease-out lg:block',
          collapsed ? 'w-[72px]' : 'w-[248px]',
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
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
            <Sidebar collapsed={false} onClose={() => setDrawerOpen(false)} />
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
        <main className="w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

/** A label beside an icon in the collapsed rail, on hover and keyboard focus. */
function RailTip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-md bg-text px-2 py-1 text-meta font-medium whitespace-nowrap text-white opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  onClose,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}) {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return (
    <nav
      aria-label={t('shell.nav')}
      className={cn(
        'flex h-full flex-col gap-6 bg-sidebar py-5 text-sidebar-text',
        // The rail's labels sit outside it, so only the full sidebar scrolls.
        collapsed ? 'items-center px-3' : 'overflow-y-auto px-4',
      )}
    >
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between')}>
        <Logo inverted markOnly={collapsed} />
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shell.closeMenu')}
            className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-sidebar-raised"
          >
            <X className="size-5" aria-hidden />
          </button>
        ) : onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
            aria-expanded={!collapsed}
            className="group relative inline-flex size-9 items-center justify-center rounded-lg hover:bg-sidebar-raised hover:text-white"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden />
            ) : (
              <PanelLeftClose className="size-5" aria-hidden />
            )}
            {collapsed ? <RailTip label={t('shell.expand')} /> : null}
          </button>
        ) : null}
      </div>
      <OrgSwitcher collapsed={collapsed} />
      <ul className={cn('flex flex-col gap-1', collapsed && 'w-full')}>
        {navFor(membership.role).map(({ to, label, Icon, end }) => (
          <li key={label}>
            <NavLink
              to={to ? `${base}/${to}` : base}
              end={end}
              aria-label={collapsed ? t(label) : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-10 items-center gap-3 rounded-lg text-label font-medium transition-colors duration-150',
                  collapsed ? 'justify-center' : 'px-3',
                  isActive ? 'bg-white text-brand' : 'hover:bg-sidebar-raised hover:text-white',
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {collapsed ? <RailTip label={t(label)} /> : t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className={cn('mt-auto', collapsed && 'w-full')}>
        <UserFooter collapsed={collapsed} />
      </div>
    </nav>
  );
}

/** The org card in the sidebar; with more than one org it opens the list of them. */
function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
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

  const card = collapsed ? (
    <>
      <Avatar name={membership.org.name} tone="org" />
      <RailTip label={membership.org.name} />
    </>
  ) : (
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
  const box = cn(
    'group relative flex items-center rounded-xl bg-sidebar-raised',
    collapsed ? 'size-12 justify-center' : 'w-full gap-3 p-3',
  );

  return (
    <div ref={ref} className="relative">
      {others ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={collapsed ? t('shell.switchOrg', { org: membership.org.name }) : undefined}
          onClick={() => setOpen((v) => !v)}
          className={cn(box, 'transition-colors duration-150 hover:bg-sidebar-raised/80')}
        >
          {card}
          {collapsed ? null : <ChevronsUpDown className="size-4 shrink-0" aria-hidden />}
        </button>
      ) : (
        <div className={box} aria-label={collapsed ? membership.org.name : undefined}>
          {card}
        </div>
      )}
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute z-50 rounded-xl border border-border bg-surface p-1 text-text shadow-pop',
            collapsed ? 'top-0 left-full ml-3 w-[260px]' : 'inset-x-0 top-full mt-2',
          )}
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

function UserFooter({ collapsed }: { collapsed: boolean }) {
  const { me, membership } = useOrg();
  const { signOut } = useClerk();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const name = me.name ?? me.email;
  return (
    <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
      <NavLink
        to={`${orgPath(membership.org.slug)}/profile`}
        aria-label={t('shell.profile')}
        className={({ isActive }) =>
          cn(
            'group relative flex min-w-0 items-center gap-3 rounded-xl transition-colors duration-150 hover:bg-sidebar-raised',
            collapsed ? 'p-1.5' : 'flex-1 px-1 py-2',
            isActive && 'bg-sidebar-raised',
          )
        }
      >
        <Avatar
          name={me.name}
          fallback={me.email ?? '?'}
          src={user?.hasImage ? user.imageUrl : null}
        />
        {collapsed ? (
          <RailTip label={t('shell.profile')} />
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label font-semibold text-white">{name}</span>
            <span className="block text-meta">{roleLabel(membership.role)}</span>
          </span>
        )}
      </NavLink>
      <button
        type="button"
        aria-label={t('common.signOut')}
        title={collapsed ? undefined : t('common.signOut')}
        onClick={() => {
          queryClient.clear();
          void signOut();
        }}
        className="group relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-sidebar-raised hover:text-white lg:size-9"
      >
        <LogOut className="size-5" aria-hidden />
        {collapsed ? <RailTip label={t('common.signOut')} /> : null}
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
