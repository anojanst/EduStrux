import type { DateFormat, Org, UpdateOrg } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PageError, PageHeader, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { orgApiPath, useOrg } from '../../lib/org';
import { COUNTRIES, localeFor, timeZoneOptions } from '../../lib/regions';
import { can } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { Toggle } from '../people/Toggle';

const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

type Form = {
  name: string;
  country: string;
  timezone: string;
  dateFormat: DateFormat;
  singleTutorMode: boolean;
  taxNumber: string;
};

const formOf = (org: Org): Form => ({
  name: org.name,
  country: org.country ?? '',
  timezone: org.timezone,
  dateFormat: org.dateFormat,
  singleTutorMode: org.singleTutorMode,
  taxNumber: org.taxNumber ?? '',
});

/**
 * Settings › Organisation (TUI-64): the owner changes the centre's name, region, date format,
 * single-tutor mode and tax number with `PATCH /orgs/{id}`. The currency shows but can't be
 * changed here: prices, invoices and payments are all in it. Colours are on Settings › Theme.
 */
export function OrganisationPage() {
  const { membership, org } = useOrg();
  if (!can(membership.role, 'org:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  if (!org) return <PageLoading />;
  return <OrganisationSettings org={org} />;
}

function OrganisationSettings({ org }: { org: Org }) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZones = useMemo(timeZoneOptions, []);
  const [form, setForm] = useState<Form>(formOf(org));
  const set = (change: Partial<Form>) => setForm({ ...form, ...change });

  const saved = formOf(org);
  const changes: Omit<UpdateOrg, 'updatedAt'> = {};
  if (form.name.trim() !== saved.name) changes.name = form.name.trim();
  if (form.country !== saved.country) {
    changes.country = form.country || null;
    changes.locale = localeFor(form.country);
  }
  if (form.timezone !== saved.timezone) changes.timezone = form.timezone;
  if (form.dateFormat !== saved.dateFormat) changes.dateFormat = form.dateFormat;
  if (form.singleTutorMode !== saved.singleTutorMode)
    changes.singleTutorMode = form.singleTutorMode;
  if (form.taxNumber.trim() !== saved.taxNumber) changes.taxNumber = form.taxNumber.trim() || null;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () =>
      api<Org>('PATCH', orgApiPath(membership), { body: { updatedAt: org.updatedAt, ...changes } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', membership.org.id], updated);
      setForm(formOf(updated));
      toast(t('organisation.saved'));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'stale_data';
  const fields = fieldErrors(save.error);
  const refused = save.error instanceof ApiError && save.error.status === 422;

  const reload = async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['org', membership.org.id],
      queryFn: () => api<Org>('GET', orgApiPath(membership)),
      staleTime: 0,
    });
    setForm(formOf(fresh));
    save.reset();
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        overline={t('organisation.overline')}
        title={t('organisation.title')}
        subtitle={t('organisation.subtitle')}
      />
      {save.error && !Object.keys(fields).length ? (
        <Notice
          tone={stale ? 'warning' : 'danger'}
          className="mb-5"
          action={
            stale ? (
              <Button variant="secondary" size="sm" onClick={() => void reload()}>
                {t('organisation.reload')}
              </Button>
            ) : null
          }
        >
          {refused ? save.error.message : errorMessage(save.error)}
        </Notice>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save.mutate();
        }}
        className="flex flex-col gap-5"
      >
        <Card className="flex flex-col gap-4 sm:p-5">
          <h2 className="text-section font-medium text-text">{t('organisation.centre')}</h2>
          <TextField
            label={t('organisation.name')}
            required
            minLength={2}
            maxLength={120}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            error={fields.name}
          />
          <div>
            <Toggle
              checked={form.singleTutorMode}
              onChange={(on) => set({ singleTutorMode: on })}
              label={t('organisation.solo')}
              hint={t('organisation.soloHint')}
            />
          </div>
          {fields.singleTutorMode ? (
            <p className="text-meta text-danger">{fields.singleTutorMode}</p>
          ) : null}
          <TextField
            label={t('organisation.taxNumber')}
            maxLength={40}
            value={form.taxNumber}
            onChange={(e) => set({ taxNumber: e.target.value })}
            helper={t('organisation.taxNumberHelper')}
            error={fields.taxNumber}
          />
        </Card>

        <Card className="flex flex-col gap-4 sm:p-5">
          <h2 className="text-section font-medium text-text">{t('organisation.region')}</h2>
          <SelectField
            label={t('onboarding.country')}
            value={form.country}
            onChange={(e) => set({ country: e.target.value })}
            options={[
              ...COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
              { value: '', label: t('onboarding.countryOther') },
            ]}
            error={fields.country}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t('onboarding.dateFormat')}
              required
              value={form.dateFormat}
              onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}
              options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              error={fields.dateFormat}
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium text-text">{t('onboarding.currency')}</p>
              <p className="flex h-11 items-center text-body text-text sm:h-10">{org.currency}</p>
              <p className="text-meta text-muted">{t('organisation.currencyHelper')}</p>
            </div>
          </div>
          <SelectField
            label={t('onboarding.timezone')}
            required
            value={form.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
            options={timeZones}
            helper={t('onboarding.timezoneHelper')}
            error={fields.timezone}
          />
        </Card>

        <p className="text-meta text-muted">
          {t('organisation.themeNote')}{' '}
          <Link
            to={`${orgPath(membership.org.slug)}/settings/theme`}
            className="font-semibold text-brand hover:underline"
          >
            {t('nav.theme')}
          </Link>
        </p>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setForm(formOf(org));
              save.reset();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!dirty && !save.isPending} loading={save.isPending}>
            {t('organisation.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
