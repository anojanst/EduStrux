import { useUser } from '@clerk/react';
import { t } from '../i18n';
import { useOrg } from '../lib/org';
import { StaffHome } from './home/StaffHome';
import { PortalHome } from './portal/PortalHome';
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
 * `/o/:orgSlug`: the parent portal's home for a parent (TUI-126), Today for a teacher (TUI-57), the staff
 * home for everyone else.
 */
export function HomePage() {
  const { membership } = useOrg();
  if (membership.role === 'parent') return <ParentHome />;
  if (membership.role === 'teacher') return <TeacherHome />;
  return <StaffHomePage />;
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

function StaffHomePage() {
  const { org } = useOrg();
  const firstName = useFirstName();
  const { overline, greeting } = todayIn(org?.timezone, org?.locale);
  return (
    <StaffHome
      overline={overline}
      greeting={firstName ? t(`${greeting}Name`, { name: firstName }) : t(greeting)}
    />
  );
}

function ParentHome() {
  const { org } = useOrg();
  const firstName = useFirstName();
  const { greeting } = todayIn(org?.timezone, org?.locale);
  return (
    <PortalHome greeting={firstName ? t(`${greeting}Name`, { name: firstName }) : t(greeting)} />
  );
}
