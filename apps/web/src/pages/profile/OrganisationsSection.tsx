import type { Branch } from '@edustrux/shared';
import { useQueries } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { useOrg } from '../../lib/org';
import { roleLabel } from '../../lib/roles';
import { orgPath, rememberOrg } from '../../lib/session';

/**
 * Every centre the user belongs to, with their role and branches there. Branch names are read
 * only for memberships limited to some branches; every role may read an org's branches.
 */
export function OrganisationsSection() {
  const { me, membership: current } = useOrg();
  const navigate = useNavigate();
  const limited = me.memberships.filter((m) => m.branchIds !== null);
  const branchLists = useQueries({
    queries: limited.map((m) => ({
      queryKey: ['branches', m.org.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<{ data: Branch[] }>('GET', `/orgs/${m.org.id}/branches?limit=200`, { signal }),
      staleTime: 5 * 60_000,
    })),
  });

  function branchesOf(m: (typeof me.memberships)[number]) {
    if (m.branchIds === null) return t('team.allBranches');
    const list = branchLists[limited.indexOf(m)]?.data?.data;
    if (!list) return t('profile.orgs.branchCount', { count: m.branchIds.length });
    return m.branchIds.map((id) => list.find((b) => b.id === id)?.name ?? id).join(', ');
  }

  return (
    <>
      <Card flush className="px-4 md:px-5">
        <ul>
          {me.memberships.map((m) => {
            const isCurrent = m.id === current.id;
            return (
              <li
                key={m.id}
                className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border py-3 last:border-0 md:min-h-[82px] md:grid-cols-[42px_minmax(0,1fr)_auto_auto] md:gap-3 md:py-0"
              >
                <Avatar name={m.org.name} tone="org" className="size-10 rounded-[9px]" />
                <div className="flex min-w-0 flex-col gap-1">
                  <b className="truncate text-label text-text">{m.org.name}</b>
                  <span className="truncate text-meta text-muted">{branchesOf(m)}</span>
                </div>
                <Badge tone={m.role === 'owner' ? 'info' : 'neutral'}>{roleLabel(m.role)}</Badge>
                {isCurrent ? (
                  <span className="col-start-2 col-end-4 flex items-center gap-1 text-meta font-semibold text-success md:col-auto">
                    <Check className="size-4" aria-hidden />
                    {t('shell.current')}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="col-start-2 col-end-4 justify-self-start max-md:h-11 md:col-auto"
                    onClick={() => {
                      rememberOrg(m.org.slug);
                      navigate(`${orgPath(m.org.slug)}/profile?section=organisations`);
                    }}
                  >
                    {t('profile.orgs.open')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="mx-[3px] my-3 text-meta text-muted">{t('profile.orgs.note')}</p>
    </>
  );
}
