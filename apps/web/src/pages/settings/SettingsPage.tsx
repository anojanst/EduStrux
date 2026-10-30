import { ChevronRight, ListChecks } from 'lucide-react';
import { Link } from 'react-router';
import { PageError, PageHeader } from '../../components/PageState';
import { t, type MessageKey } from '../../i18n';
import { settingsFor, type NavItem } from '../../layouts/AppShell';
import { ApiError } from '../../lib/api';
import { useOrg } from '../../lib/org';
import { can } from '../../lib/roles';
import { orgPath } from '../../lib/session';

/**
 * Settings (TUI-130): the settings screens the role can open, as cards. The sidebar has one
 * Settings link in their place; the owner also finds the setup wizard here.
 */
export function SettingsPage() {
  const { membership } = useOrg();
  const items = settingsFor(membership.role);
  if (!items.length) return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  const base = orgPath(membership.org.slug);
  const all: (NavItem & { body: MessageKey })[] = [
    ...(can(membership.role, 'org:write')
      ? [
          {
            to: 'setup',
            label: 'settings.setup' as const,
            body: 'settings.setupBody' as const,
            Icon: ListChecks,
          },
        ]
      : []),
    ...items.map((item) => ({
      ...item,
      body: `settings.body.${item.to.replace('settings/', '')}` as MessageKey,
    })),
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader
        overline={t('settings.overline')}
        title={t('nav.settings')}
        subtitle={t('settings.subtitle')}
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {all.map(({ to, label, body, Icon }) => (
          <li key={to}>
            <Link
              to={`${base}/${to}`}
              className="grid min-h-[76px] grid-cols-[40px_1fr_16px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors duration-150 hover:bg-canvas"
            >
              <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <b className="text-label font-semibold text-text">{t(label)}</b>
                <small className="text-meta text-muted">{t(body)}</small>
              </span>
              <ChevronRight className="size-4 text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
