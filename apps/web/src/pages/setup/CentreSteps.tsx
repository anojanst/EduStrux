import type { DateFormat, Org } from '@edustrux/shared';
import { Building2, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Field, SelectField, TextField } from '../../components/ui/Field';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import {
  browserDefaults,
  COUNTRIES,
  currencyFor,
  currencyOptions,
  dateFormatFor,
  timeZoneOptions,
} from '../../lib/regions';
import { ChoiceCard } from './SetupLayout';

const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/** What the first two steps ask: the org's own settings, before or after it exists. */
export type CentreDraft = {
  name: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  dateFormat: DateFormat;
  solo: boolean;
};

export function newDraft(): CentreDraft {
  const defaults = browserDefaults();
  return {
    name: '',
    slug: '',
    country: defaults.country,
    currency: defaults.currency,
    timezone: defaults.timeZone,
    dateFormat: dateFormatFor(defaults.country),
    solo: false,
  };
}

export function draftOf(org: Org): CentreDraft {
  return {
    name: org.name,
    slug: org.slug,
    country: org.country ?? '',
    currency: org.currency,
    timezone: org.timezone,
    dateFormat: org.dateFormat,
    solo: org.singleTutorMode,
  };
}

/** The web address a name suggests, as the API makes one (3 to 48 of a–z, 0–9 and dashes). */
export function slugFrom(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Step 1: name, web address (only while creating: it's in every link afterwards), country, and
 * the currency, time zone and date format the country suggests, shown as a summary to Edit.
 * The currency can't change once the org exists.
 */
export function DetailsFields({
  draft,
  onChange,
  creating,
  errors,
}: {
  draft: CentreDraft;
  onChange: (change: Partial<CentreDraft>) => void;
  creating: boolean;
  errors: Record<string, string>;
}) {
  const [slugTouched, setSlugTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const currencies = useMemo(currencyOptions, []);
  const timeZones = useMemo(timeZoneOptions, []);
  const regionErrors = Boolean(errors.currency || errors.timezone || errors.dateFormat);

  function chooseCountry(code: string) {
    const change: Partial<CentreDraft> = { country: code, dateFormat: dateFormatFor(code) };
    const known = currencyFor(code);
    if (creating && known) change.currency = known;
    onChange(change);
  }

  return (
    <>
      <TextField
        label={t('setup.details.name')}
        required
        autoFocus
        autoComplete="organization"
        minLength={2}
        maxLength={120}
        placeholder={t('onboarding.namePlaceholder')}
        value={draft.name}
        onChange={(e) =>
          onChange({
            name: e.target.value,
            ...(creating && !slugTouched ? { slug: slugFrom(e.target.value) } : {}),
          })
        }
        error={errors.name}
      />
      <Field
        label={t('setup.details.address')}
        helper={creating ? t('setup.details.addressHelper') : t('setup.details.addressFixed')}
        error={errors.slug}
      >
        {({ className, ...props }) => (
          <div
            className={cn(
              className,
              'flex items-center p-0 focus-within:outline-2 focus-within:outline-brand',
            )}
          >
            <span className="flex h-full shrink-0 items-center border-r border-border-strong bg-canvas px-3 text-muted">
              {`${window.location.host}/o/`}
            </span>
            <input
              {...props}
              value={draft.slug}
              disabled={!creating}
              maxLength={48}
              onChange={(e) => {
                setSlugTouched(true);
                onChange({ slug: e.target.value.toLowerCase() });
              }}
              className="h-full min-w-0 flex-1 rounded-r-lg bg-transparent px-3 outline-none disabled:text-subtle"
            />
          </div>
        )}
      </Field>
      <SelectField
        label={t('onboarding.country')}
        value={draft.country}
        onChange={(e) => chooseCountry(e.target.value)}
        options={[
          ...COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
          { value: '', label: t('onboarding.countryOther') },
        ]}
        error={errors.country}
      />
      {editing || regionErrors ? (
        <div className="grid gap-4 rounded-xl border border-border bg-canvas p-4 sm:grid-cols-2">
          {creating ? (
            <SelectField
              label={t('onboarding.currency')}
              required
              value={draft.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              options={currencies}
              error={errors.currency}
            />
          ) : null}
          <SelectField
            label={t('onboarding.dateFormat')}
            required
            value={draft.dateFormat}
            onChange={(e) => onChange({ dateFormat: e.target.value as DateFormat })}
            options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
            error={errors.dateFormat}
          />
          <div className="sm:col-span-2">
            <SelectField
              label={t('onboarding.timezone')}
              required
              value={draft.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
              options={timeZones}
              helper={t('onboarding.timezoneHelper')}
              error={errors.timezone}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4 rounded-xl border border-border bg-canvas p-4">
          <dl className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <Summary label={t('onboarding.currency')} value={draft.currency} />
            <Summary
              label={t('setup.details.timezone')}
              value={draft.timezone.replaceAll('_', ' ')}
            />
            <Summary label={t('onboarding.dateFormat')} value={draft.dateFormat} />
          </dl>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-label font-semibold text-brand hover:underline"
          >
            {t('setup.details.edit')}
          </button>
        </div>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta tracking-[0.05em] text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-label font-semibold text-text">{value}</dd>
    </div>
  );
}

/** Step 2: a solo tutor or a centre with staff (single-tutor mode, D-032). */
export function TypeFields({
  solo,
  onChange,
  error,
}: {
  solo: boolean;
  onChange: (solo: boolean) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{t('setup.type.title')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          name="setup-type"
          checked={solo}
          onChange={() => onChange(true)}
          icon={<UserRound className="size-5" />}
          title={t('onboarding.modeSolo')}
          body={t('setup.type.soloBody')}
        />
        <ChoiceCard
          name="setup-type"
          checked={!solo}
          onChange={() => onChange(false)}
          icon={<Building2 className="size-5" />}
          title={t('setup.type.team')}
          body={t('setup.type.teamBody')}
        />
      </div>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
    </fieldset>
  );
}
