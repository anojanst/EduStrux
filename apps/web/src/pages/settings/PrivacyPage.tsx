import type { Org } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageError, PageHeader, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SelectField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { orgApiPath, useOrg } from '../../lib/org';
import { can } from '../../lib/roles';

const YEARS = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * Settings › Privacy & data (TUI-118, D-171): the owner sets how many years an erased family's
 * invoices and payments are kept, from the centre's local tax law, with `PATCH /orgs/{id}`. It
 * also says what happens to inactive families, which isn't a setting.
 */
export function PrivacyPage() {
  const { membership, org } = useOrg();
  if (!can(membership.role, 'org:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  if (!org) return <PageLoading />;
  return <PrivacySettings org={org} />;
}

function PrivacySettings({ org }: { org: Org }) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [years, setYears] = useState(org.financialRetentionYears);
  const dirty = years !== org.financialRetentionYears;

  const save = useMutation({
    mutationFn: () =>
      api<Org>('PATCH', orgApiPath(membership), {
        body: { updatedAt: org.updatedAt, financialRetentionYears: years },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', membership.org.id], updated);
      toast(t('privacy.saved'));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'stale_data';

  const reload = async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['org', membership.org.id],
      queryFn: () => api<Org>('GET', orgApiPath(membership)),
      staleTime: 0,
    });
    setYears(fresh.financialRetentionYears);
    save.reset();
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        overline={t('privacy.overline')}
        title={t('privacy.title')}
        subtitle={t('privacy.subtitle')}
      />
      {save.error ? (
        <Notice
          tone={stale ? 'warning' : 'danger'}
          className="mb-5"
          action={
            stale ? (
              <Button variant="secondary" size="sm" onClick={() => void reload()}>
                {t('privacy.reload')}
              </Button>
            ) : null
          }
        >
          {errorMessage(save.error)}
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-4 sm:p-5">
        <h2 className="text-section font-medium text-text">{t('privacy.records')}</h2>
        <SelectField
          label={t('privacy.retention')}
          helper={t('privacy.retentionHelper')}
          value={years === null ? '' : String(years)}
          onChange={(event) => setYears(event.target.value ? Number(event.target.value) : null)}
          options={[
            { value: '', label: t('privacy.notSet') },
            ...YEARS.map((n) => ({
              value: String(n),
              label: n === 1 ? t('privacy.years.one') : t('privacy.years', { n }),
            })),
          ]}
        />
        {org.financialRetentionYears === null ? (
          <Notice tone="info">{t('privacy.notSetNotice')}</Notice>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setYears(org.financialRetentionYears);
              save.reset();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!dirty && !save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('privacy.save')}
          </Button>
        </div>
      </Card>

      <Card className="mt-5 flex flex-col gap-2 sm:p-5">
        <h2 className="text-section font-medium text-text">{t('privacy.inactive')}</h2>
        <p className="text-body text-muted">{t('privacy.inactiveBody')}</p>
      </Card>
    </div>
  );
}
