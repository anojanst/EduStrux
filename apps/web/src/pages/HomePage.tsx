import { useUser } from '@clerk/react';
import type { PortalChild } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, ChevronRight, GraduationCap, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { PageError, PageHeader } from '../components/PageState';
import { Avatar } from '../components/ui/Avatar';
import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { api } from '../lib/api';
import { orgApiPath, useOrg } from '../lib/org';
import { can, roleLabel } from '../lib/roles';
import { orgPath } from '../lib/session';
import { TeacherToday } from './today/TeacherToday';

/** The day and part of the day in the org's time zone (UTC until the org has loaded). */
function todayIn(timeZone: string | undefined, locale: string | undefined) {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
  );
  const overline = new Intl.DateTimeFormat(locale ?? 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(now);
  const greeting = hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening';
  return { overline, greeting } as const;
}

function useFirstName() {
  const { user } = useUser();
  const { me } = useOrg();
  return user?.firstName ?? me.name?.split(/\s+/)[0] ?? null;
}

/**
 * `/o/:orgSlug`: the parent portal's home for a parent, Today for a teacher (TUI-57), the staff
 * home for everyone else.
 */
export function HomePage() {
  const { membership } = useOrg();
  if (membership.role === 'parent') return <PortalHome />;
  if (membership.role === 'teacher') return <TeacherHome />;
  return <StaffHome />;
}

function TeacherHome() {
  const { org } = useOrg();
  const firstName = useFirstName();
  const { overline, greeting } = todayIn(org?.timezone, org?.locale);
  return (
    <TeacherToday
      overline={overline}
      greeting={firstName ? t(`${greeting}Name`, { name: firstName }) : t(greeting)}
    />
  );
}

/**
 * The staff home until the dashboard is built (ui-design.md §9, TUI-40): the greeting, and for
 * whoever can invite staff, the next step after creating the centre.
 */
function StaffHome() {
  const { org, membership } = useOrg();
  const firstName = useFirstName();
  const { overline, greeting } = todayIn(org?.timezone, org?.locale);
  const invites = can(membership.role, 'staff:write');
  return (
    <>
      <PageHeader
        overline={overline}
        title={firstName ? t(`${greeting}Name`, { name: firstName }) : t(greeting)}
        subtitle={t('home.subtitle', {
          org: membership.org.name,
          role: roleLabel(membership.role),
        })}
      />
      <Card>
        <h2 className="text-section font-medium text-text">{t('home.setup.title')}</h2>
        <ul className="mt-4 divide-y divide-border">
          <li className="flex items-center gap-3 py-3">
            <CircleCheck className="size-5 text-success" aria-hidden />
            <span className="flex-1 text-body text-text">
              {t('home.setup.signedIn', { org: membership.org.name })}
            </span>
          </li>
          {invites ? (
            <li>
              <Link
                to={`${orgPath(membership.org.slug)}/settings/team`}
                className="flex items-center gap-3 py-3 hover:bg-canvas"
              >
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <UsersRound className="size-4" aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-body font-semibold text-text">
                    {t('home.setup.inviteTitle')}
                  </span>
                  <span className="block text-meta text-muted">{t('home.setup.inviteBody')}</span>
                </span>
                <ChevronRight className="size-4 text-subtle" aria-hidden />
              </Link>
            </li>
          ) : null}
        </ul>
        <p className="mt-2 text-meta text-muted">{t('home.setup.more')}</p>
      </Card>
    </>
  );
}

/**
 * The parent portal's home: their children (`GET /portal/children`), which also shows the
 * invite linked them to the right family. Timetable, invoices and messages follow (TUI-39).
 */
function PortalHome() {
  const { membership } = useOrg();
  const firstName = useFirstName();
  const children = useQuery({
    queryKey: ['portal', membership.org.id, 'children'],
    queryFn: ({ signal }) =>
      api<{ data: PortalChild[] }>('GET', orgApiPath(membership, '/portal/children'), { signal }),
  });

  return (
    <>
      <PageHeader
        overline={membership.org.name}
        title={firstName ? t('portal.helloName', { name: firstName }) : t('portal.hello')}
        subtitle={t('portal.subtitle')}
      />
      <Card>
        <h2 className="text-section font-medium text-text">{t('portal.children')}</h2>
        {children.isPending ? (
          <ul className="mt-4 flex flex-col gap-3" aria-hidden>
            {[0, 1].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-canvas" />
            ))}
          </ul>
        ) : children.isError ? (
          <PageError error={children.error} onRetry={() => void children.refetch()} />
        ) : children.data.data.length === 0 ? (
          <div className="mt-4 flex items-center gap-3 text-body text-muted">
            <GraduationCap className="size-5" aria-hidden />
            {t('portal.noChildren')}
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {children.data.data.map((child) => (
              <li key={child.id} className="flex items-center gap-3 py-3">
                <Avatar name={`${child.firstName} ${child.lastName}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-text">
                    {child.firstName} {child.lastName}
                  </span>
                  <span className="block text-meta text-muted">
                    {t('portal.childMeta', {
                      family: child.familyName,
                      count: child.enrolments.length,
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
