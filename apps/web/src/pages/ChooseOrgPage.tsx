import { ChevronRight, Plus } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { PageError, PageLoading } from '../components/PageState';
import { Avatar } from '../components/ui/Avatar';
import { Card } from '../components/ui/Card';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';
import { roleLabel } from '../lib/roles';
import { orgPath, rememberOrg, useMe } from '../lib/session';

/** A user in several orgs (a tutor at two centres, a parent with children at both) picks one. */
export function ChooseOrgPage() {
  const me = useMe();
  if (me.isPending) return <PageLoading />;
  if (me.isError) return <PageError error={me.error} onRetry={() => void me.refetch()} />;
  if (me.data.memberships.length === 0) return <Navigate to="/welcome" replace />;

  return (
    <AuthLayout>
      <h1 className="text-title font-normal text-text">{t('orgs.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('orgs.subtitle')}</p>
      <ul className="mt-6 flex flex-col gap-3">
        {me.data.memberships.map((m) => (
          <li key={m.id}>
            <Link
              to={orgPath(m.org.slug)}
              onClick={() => rememberOrg(m.org.slug)}
              className="group block"
            >
              <Card className="flex items-center gap-4 transition-colors duration-150 group-hover:border-border-strong group-hover:bg-canvas">
                <Avatar name={m.org.name} tone="org" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-text">
                    {m.org.name}
                  </span>
                  <span className="block text-meta text-muted">{roleLabel(m.role)}</span>
                </span>
                <ChevronRight className="size-4 text-subtle" aria-hidden />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/onboarding"
        className="mt-6 inline-flex items-center gap-2 text-label font-medium text-brand hover:underline"
      >
        <Plus className="size-4" aria-hidden />
        {t('orgs.startAnother')}
      </Link>
    </AuthLayout>
  );
}
