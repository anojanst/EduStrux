import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  Ellipsis,
  House,
  LogOut,
  MapPin,
  Megaphone,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ReceiptText,
  ShieldCheck,
  School,
  Search,
  Settings as SettingsIcon,
  Tag,
  TriangleAlert,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { Logo } from '../components/Logo';
import { SearchPalette } from '../components/SearchPalette';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Menu as ActionMenu, type MenuItem } from '../components/ui/Menu';
import { t, type MessageKey } from '../i18n';
import { cn } from '../lib/cn';
import { useOrg } from '../lib/org';
import { RecordPaymentDialog } from '../pages/billing/RecordPaymentDialog';
import { ClassDialog } from '../pages/classes/ClassDialog';
import { NewAnnouncementDialog } from '../pages/messages/NewAnnouncement';
import { AddFamilyDialog } from '../pages/people/AddFamilyDialog';
import { orgBanner, seesTrialBanner } from '../lib/orgStatus';
import { can, roleLabel, type Role } from '../lib/roles';
import { orgPath, rememberOrg } from '../lib/session';

export type NavItem = { to: string; label: MessageKey; Icon: LucideIcon; end?: boolean };

/**
 * The nav for a role (ui-design.md §5): only what the role can use. More areas join as their
 * screens are built (TUI-40 onwards).
 */
function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [{ to: '', label: 'nav.home', Icon: House, end: true }];
  if (role === 'parent') return [...items, ...PORTAL_NAV];
  if (can(role, 'classes:read')) {
    items.push({ to: 'timetable', label: 'nav.timetable', Icon: CalendarDays });
    items.push({ to: 'classes', label: 'nav.classes', Icon: School });
  }
  if (canSearchPeople(role)) {
    items.push({ to: 'families', label: 'nav.people', Icon: Users });
  }
  if (can(role, 'billing:read')) {
    items.push({ to: 'invoices', label: 'nav.invoices', Icon: ReceiptText });
    items.push({ to: 'payments', label: 'nav.payments', Icon: Wallet });
  }
  if (can(role, 'messages:read')) {
    items.push({ to: 'messages', label: 'nav.messages', Icon: MessageSquare });
  }
  return items;
}

/**
 * The settings screens a role can open, in the order Settings lists them. They sit behind one
 * Settings link at the foot of the sidebar (TUI-130).
 */
export function settingsFor(role: Role): NavItem[] {
  if (role === 'parent') return [];
  const items: NavItem[] = [];
  if (can(role, 'org:write')) {
    items.push({ to: 'settings/organisation', label: 'nav.organisation', Icon: Building2 });
  }
  if (can(role, 'classes:write')) {
    items.push({ to: 'settings/branches', label: 'nav.branches', Icon: MapPin });
    items.push({ to: 'settings/terms', label: 'nav.terms', Icon: CalendarRange });
    items.push({ to: 'settings/courses', label: 'nav.courses', Icon: BookOpen });
  }
  if (can(role, 'billing:read')) {
    items.push({ to: 'settings/pricing', label: 'nav.pricing', Icon: Tag });
  }
  if (can(role, 'staff:read')) {
    items.push({ to: 'settings/team', label: 'nav.team', Icon: UsersRound });
  }
  if (can(role, 'org:write')) {
    items.push({ to: 'settings/theme', label: 'nav.theme', Icon: Palette });
    items.push({ to: 'settings/privacy', label: 'nav.privacy', Icon: ShieldCheck });
  }
  return items;
}

/** The parent portal's areas (TUI-126), after Home: the sidebar, and the tab bar on phones. */
const PORTAL_NAV: NavItem[] = [
  { to: 'timetable', label: 'nav.timetable', Icon: CalendarDays },
  { to: 'invoices', label: 'nav.invoices', Icon: ReceiptText },
  { to: 'messages', label: 'nav.messages', Icon: MessageSquare },
  { to: 'more', label: 'nav.more', Icon: Ellipsis },
];

/**
 * The tab bar on phones (ui-design.md §5): four areas for the role, then More. A parent's More is
 * the portal's More page; anyone else's opens the full menu as a drawer (D-185).
 */
function tabsFor(role: Role): NavItem[] {
  const nav = navFor(role);
  if (role === 'parent') return nav;
  const named = (to: string) => {
    const item = nav.find((i) => i.to === to);
    if (!item) return [];
    return [to === 'families' ? { ...item, label: 'nav.families' as const } : item];
  };
  if (role === 'teacher') {
    return [
      { ...nav[0]!, label: 'nav.today', Icon: CalendarCheck },
      ...named('timetable'),
      ...named('messages'),
    ];
  }
  const picked = [nav[0]!, ...['timetable', 'families', 'invoices'].flatMap(named)];
  // A role without one of those gets its next main areas (not settings), up to four tabs.
  const rest = nav.filter(
    (item) => !item.to.startsWith('settings/') && !picked.some((p) => p.to === item.to),
  );
  return [...picked, ...rest].slice(0, 4);
}

/** Staff who read families get the people area and the search; parents use the portal. */
function canSearchPeople(role: Role) {
  return can(role, 'people:read') && role !== 'parent';
}

/** Ctrl/⌘ K opens the search from anywhere in the app. */
function useSearchShortcut(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, open]);
}

const SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⌘ K'
    : 'Ctrl K';

/** Whether a media query matches, kept up to date; false where the browser can't tell (tests). */
function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Whether the browser is online, for the offline banner (ui-design.md §6 Banners). */
function useOnline() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
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
 * The app shell (ui-design.md §5): a sidebar in the org's theme on desktop that collapses to a
 * 72px icon rail; the rail on tablets, opening the full sidebar as a drawer; and on phones a top
 * bar and a tab bar whose More opens that drawer (D-185). The org's banner sits above the page,
 * which fills the width beside the sidebar, edge to edge.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [searching, setSearching] = useState(false);
  const location = useLocation();
  const { membership } = useOrg();
  const canSearch = canSearchPeople(membership.role);
  const canCreate = newItemsFor(membership.role).length > 0;
  // Between 640 and 1023px the sidebar is always the rail, and its button opens the drawer.
  const tablet = useMedia('(min-width: 640px) and (max-width: 1023px)');
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useSearchShortcut(
    canSearch,
    useCallback(() => setSearching(true), []),
  );

  return (
    <div className="min-h-dvh bg-canvas sm:flex">
      <aside
        className={cn(
          'sticky top-0 z-20 hidden h-dvh w-[72px] shrink-0 transition-[width] duration-150 ease-out sm:block',
          !collapsed && 'lg:w-[248px]',
        )}
      >
        {tablet ? (
          <Sidebar collapsed opensMenu onToggle={() => setDrawerOpen(true)} />
        ) : (
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        )}
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
        <header
          className={cn(
            // Under an installed app's status bar on iPhones the bar grows by the safe area.
            'sticky top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-8',
          )}
        >
          <span className="sm:hidden">
            <Logo />
          </span>
          <OrgSwitcher />
          {canSearch ? (
            <>
              <button
                type="button"
                onClick={() => setSearching(true)}
                className="hidden h-10 w-full max-w-[420px] items-center gap-2.5 rounded-lg border border-border bg-canvas px-3 text-left text-body text-subtle hover:border-border-strong sm:ml-auto sm:flex"
              >
                <Search className="size-4" aria-hidden />
                <span className="flex-1">{t('search.placeholder')}</span>
                <kbd className="rounded border border-border bg-surface px-1.5 text-meta text-muted">
                  {SHORTCUT}
                </kbd>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto sm:hidden"
                aria-label={t('search.title')}
                onClick={() => setSearching(true)}
                icon={<Search className="size-5 text-text" />}
              />
            </>
          ) : null}
          {canCreate ? <NewMenu pushRight={!canSearch} /> : null}
          <UserMenu pushRight={!canSearch && !canCreate} />
        </header>
        {searching ? <SearchPalette onClose={() => setSearching(false)} /> : null}
        <OfflineBanner />
        <OrgBanner />
        {/* On phones the page ends above the tab bar. */}
        <main className="w-full flex-1 px-4 py-6 max-sm:pb-[calc(90px+env(safe-area-inset-bottom))] sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
      <TabBar onMore={() => setDrawerOpen(true)} moreOpen={drawerOpen} />
    </div>
  );
}

const TAB =
  'flex h-[66px] min-w-0 flex-col items-center justify-center gap-[3px] px-1 text-meta [&>span]:max-w-full [&>span]:truncate';

/**
 * The role's tabs fixed to the foot of a phone screen. Staff's More opens the menu drawer.
 */
function TabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { membership } = useOrg();
  const { pathname } = useLocation();
  const base = orgPath(membership.org.slug);
  const tabs = tabsFor(membership.role);
  const href = (to: string) => (to ? `${base}/${to}` : base);
  const at = ({ to, end }: NavItem) =>
    end ? pathname === href(to) : pathname.startsWith(href(to));
  // More is lit for an area of the menu that isn't a tab (Team, Classes), not for a page
  // reached from inside one (a lesson, a student).
  const inMore =
    navFor(membership.role).some((item) => !tabs.some((tab) => tab.to === item.to) && at(item)) ||
    pathname.startsWith(href('settings'));
  return (
    <nav
      aria-label={t('shell.tabs')}
      className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={href(to)}
          end={end}
          className={({ isActive }) =>
            cn(TAB, isActive ? 'font-semibold text-brand' : 'text-muted')
          }
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span>{t(label)}</span>
        </NavLink>
      ))}
      {membership.role === 'parent' ? null : (
        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          className={cn(TAB, moreOpen || inMore ? 'font-semibold text-brand' : 'text-muted')}
        >
          <Ellipsis className="size-5 shrink-0" aria-hidden />
          <span>{t('nav.more')}</span>
        </button>
      )}
    </nav>
  );
}

type NewKind = 'family' | 'class' | 'payment' | 'announcement';

/** What the role may create from "+ New" (ui-design.md §5), in the menu's order. */
function newItemsFor(role: Role): NewKind[] {
  if (role === 'parent') return [];
  const kinds: NewKind[] = [];
  if (can(role, 'people:write')) kinds.push('family');
  if (can(role, 'classes:write')) kinds.push('class');
  if (can(role, 'billing:write')) kinds.push('payment');
  if (can(role, 'messages:write')) kinds.push('announcement');
  return kinds;
}

const NEW_ICONS = {
  family: Users,
  class: School,
  payment: Wallet,
  announcement: Megaphone,
} as const;

/**
 * "+ New" in the top bar: the primary button with a menu of what the role may create, a 44px
 * icon button on phones. Each opens the same dialog as its own page.
 */
function NewMenu({ pushRight }: { pushRight: boolean }) {
  const { membership } = useOrg();
  const [open, setOpen] = useState<NewKind | null>(null);
  const items: MenuItem[] = newItemsFor(membership.role).map((kind) => ({
    label: t(`shell.new.${kind}`),
    Icon: NEW_ICONS[kind],
    onSelect: () => setOpen(kind),
  }));
  const close = () => setOpen(null);
  return (
    <div className={cn(pushRight && 'ml-auto')}>
      <ActionMenu
        label={t('shell.new')}
        items={items}
        className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand text-label font-semibold text-white transition-colors duration-150 hover:bg-brand-hover sm:h-10 sm:w-auto sm:px-4"
      >
        <Plus className="size-5 sm:size-4" aria-hidden />
        <span className="max-sm:sr-only">{t('shell.new')}</span>
      </ActionMenu>
      <AddFamilyDialog open={open === 'family'} onClose={close} />
      <ClassDialog open={open === 'class'} onClose={close} />
      <RecordPaymentDialog open={open === 'payment'} onClose={close} />
      <NewAnnouncementDialog open={open === 'announcement'} onClose={close} />
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
  opensMenu = false,
  onToggle,
  onClose,
}: {
  collapsed: boolean;
  /** On tablets the rail's button opens the full sidebar as a drawer. */
  opensMenu?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}) {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return (
    <nav
      aria-label={t('shell.nav')}
      className={cn(
        // A light theme's sidebar needs an edge against the canvas; on a dark one it doesn't show.
        'flex h-full flex-col gap-6 border-r border-black/5 bg-sidebar py-5 text-sidebar-text',
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
            aria-label={
              opensMenu ? t('shell.openMenu') : collapsed ? t('shell.expand') : t('shell.collapse')
            }
            aria-expanded={opensMenu ? false : !collapsed}
            className="group relative inline-flex size-9 items-center justify-center rounded-lg hover:bg-sidebar-raised hover:text-sidebar-strong"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden />
            ) : (
              <PanelLeftClose className="size-5" aria-hidden />
            )}
            {collapsed ? (
              <RailTip label={opensMenu ? t('shell.openMenu') : t('shell.expand')} />
            ) : null}
          </button>
        ) : null}
      </div>
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
                  isActive
                    ? 'bg-sidebar-active text-brand'
                    : 'hover:bg-sidebar-raised hover:text-sidebar-strong',
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {collapsed ? <RailTip label={t(label)} /> : t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
      {settingsFor(membership.role).length ? (
        <div className={cn('mt-auto border-t border-sidebar-raised pt-4', collapsed && 'w-full')}>
          <NavLink
            to={`${base}/settings`}
            aria-label={collapsed ? t('nav.settings') : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-lg text-label font-medium transition-colors duration-150',
                collapsed ? 'justify-center' : 'px-3',
                isActive
                  ? 'bg-sidebar-active text-brand'
                  : 'hover:bg-sidebar-raised hover:text-sidebar-strong',
              )
            }
          >
            <SettingsIcon className="size-5 shrink-0" aria-hidden />
            {collapsed ? <RailTip label={t('nav.settings')} /> : t('nav.settings')}
          </NavLink>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * The centre in the header (TUI-130): its badge and, on wider screens, its name. With more than
 * one centre it opens the list of them and "Start another centre".
 */
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
      <Avatar name={membership.org.name} tone="org" className="rounded-lg" />
      <span aria-hidden className="h-6 w-px bg-border" />
      <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="max-w-[220px] truncate text-label font-semibold text-text">
        {membership.org.name}
      </span>
    </>
  );
  const box = 'hidden h-10 shrink-0 items-center gap-3 rounded-lg pr-2 sm:flex';

  return (
    <div ref={ref} className="relative">
      {others ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('shell.switchOrg', { org: membership.org.name })}
          onClick={() => setOpen((v) => !v)}
          className={cn(box, 'transition-colors duration-150 hover:bg-canvas')}
        >
          {card}
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      ) : (
        <div className={box}>{card}</div>
      )}
      {open ? (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-2 w-[280px] rounded-xl border border-border bg-surface p-1 text-text shadow-pop"
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
              <Avatar name={m.org.name} tone="org" className="size-8 rounded-lg" />
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

/**
 * The signed-in person at the right of the header (TUI-130): their photo or initials, opening
 * their profile, switching centre (on phones, where the header has no room for it) and signing
 * out.
 */
function UserMenu({ pushRight }: { pushRight: boolean }) {
  const { me, membership } = useOrg();
  const { signOut } = useClerk();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const items: MenuItem[] = [
    {
      label: t('shell.profile'),
      Icon: UserRound,
      onSelect: () => navigate(`${orgPath(membership.org.slug)}/profile`),
    },
  ];
  if (me.memberships.length > 1) {
    items.push({
      label: t('shell.switchCentre'),
      Icon: ArrowLeftRight,
      onSelect: () => navigate('/orgs'),
    });
  }
  items.push({
    label: t('common.signOut'),
    Icon: LogOut,
    danger: true,
    onSelect: () => {
      queryClient.clear();
      void signOut();
    },
  });
  return (
    <div className={cn('shrink-0 sm:border-l sm:border-border sm:pl-3', pushRight && 'ml-auto')}>
      <ActionMenu
        label={t('shell.account', { name: me.name ?? me.email ?? '' })}
        items={items}
        className="flex h-11 items-center gap-1.5 rounded-lg px-1 hover:bg-canvas sm:h-10"
      >
        <Avatar
          name={me.name}
          fallback={me.email ?? '?'}
          src={user?.hasImage ? user.imageUrl : null}
        />
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
      </ActionMenu>
    </div>
  );
}

/** Offline: nothing can be loaded or saved until the connection is back (ui-design.md §6). */
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 text-body text-text sm:px-8"
    >
      <WifiOff className="size-4 shrink-0 text-muted" aria-hidden />
      <p className="flex-1">{t('banner.offline')}</p>
    </div>
  );
}

const TRIAL_DISMISSED = 'edustrux.trialBannerDismissed';

/** Trial days left, read-only, or a payment problem (ui-design.md §6 Banners). */
function OrgBanner() {
  const { org, membership } = useOrg();
  const { pathname } = useLocation();
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
    // Home has its own trial card (TUI-130).
    const home = pathname === orgPath(membership.org.slug);
    if (dismissed || home || !seesTrialBanner(membership.role)) return null;
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
