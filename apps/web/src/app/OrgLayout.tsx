import type { Org } from '@edustrux/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, Outlet, useMatch, useParams } from 'react-router';
import { PageError, PageLoading } from '../components/PageState';
import { buttonClass } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { AppShell } from '../layouts/AppShell';
import { AuthLayout } from '../layouts/AuthLayout';
import { api } from '../lib/api';
import { OrgContext, orgApiPath } from '../lib/org';
import { rememberOrg, useMe } from '../lib/session';
import { useOrgTheme } from '../lib/theme';

/**
 * `/o/:orgSlug/*`: the org from the user's memberships (`GET /me`), its settings, and the app
 * shell around the page (not the setup wizard's full screen), in the org's theme (D-165). A slug the user isn't a member of shows a dead end, not the org.
 */
export function OrgLayout() {
  const { orgSlug = '' } = useParams();
  const me = useMe();
  const membership = me.data?.memberships.find((m) => m.org.slug === orgSlug);
  // The setup wizard has a full screen of its own (TUI-130).
  const fullScreen = useMatch('/o/:orgSlug/setup') !== null;

  const org = useQuery({
    queryKey: ['org', membership?.org.id],
    queryFn: ({ signal }) => api<Org>('GET', orgApiPath(membership!), { signal }),
    enabled: membership !== undefined,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (membership) rememberOrg(membership.org.slug);
  }, [membership]);
  useOrgTheme(membership?.org.id, org.data?.theme);

  if (me.isPending) return <PageLoading />;
  if (me.isError) return <PageError error={me.error} onRetry={() => void me.refetch()} />;
  if (!membership) return <NoAccess />;

  return (
    <OrgContext.Provider value={{ me: me.data, membership, org: org.data }}>
      {fullScreen ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
    </OrgContext.Provider>
  );
}

function NoAccess() {
  return (
    <AuthLayout>
      <Card className="flex flex-col items-start gap-3">
        <h1 className="text-section font-medium text-text">{t('org.noAccess.title')}</h1>
        <p className="text-body text-muted">{t('org.noAccess.body')}</p>
        <Link to="/" className={buttonClass('secondary')}>
          {t('common.continue')}
        </Link>
      </Card>
    </AuthLayout>
  );
}
