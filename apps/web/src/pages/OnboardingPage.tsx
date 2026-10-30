import type { CreateOrg, DateFormat, Org } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../components/PageState';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';
import { api, ApiError, fieldErrors } from '../lib/api';
import { cn } from '../lib/cn';
import {
  browserDefaults,
  COUNTRIES,
  currencyFor,
  currencyOptions,
  dateFormatFor,
  localeFor,
  timeZoneOptions,
} from '../lib/regions';
import { meKey, orgPath, rememberOrg } from '../lib/session';

const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/**
 * The first step after a centre owner signs up: `POST /orgs` makes the org with its Main branch
 * and starts the 14-day trial (D-031, D-153). Only what the org can't be made without is asked
 * here; the setup wizard it opens next asks for terms, grades, subjects and tax (TUI-64).
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaults = useMemo(browserDefaults, []);
  const currencies = useMemo(currencyOptions, []);
  const timeZones = useMemo(timeZoneOptions, []);

  const [name, setName] = useState('');
  const [solo, setSolo] = useState(false);
  const [country, setCountry] = useState(defaults.country);
  const [currency, setCurrency] = useState(defaults.currency);
  const [timezone, setTimezone] = useState(defaults.timeZone);
  const [dateFormat, setDateFormat] = useState<DateFormat>(dateFormatFor(defaults.country));

  const create = useMutation({
    mutationFn: (body: CreateOrg) => api<Org>('POST', '/orgs', { body }),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      rememberOrg(org.slug);
      navigate(`${orgPath(org.slug)}/setup`, { replace: true });
    },
  });
  const errors = fieldErrors(create.error);
  const formError =
    create.error && !(create.error instanceof ApiError && create.error.status === 400)
      ? errorMessage(create.error)
      : null;

  function chooseCountry(code: string) {
    setCountry(code);
    const known = currencyFor(code);
    if (known) setCurrency(known);
    setDateFormat(dateFormatFor(code));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      name: name.trim(),
      ...(country ? { country } : {}),
      currency,
      timezone,
      locale: localeFor(country),
      dateFormat,
      singleTutorMode: solo,
    });
  }

  return (
    <AuthLayout aside={<OnboardingAside />}>
      <p className="text-meta font-semibold tracking-[0.05em] text-muted uppercase">
        {t('onboarding.overline')}
      </p>
      <h1 className="mt-1 text-title font-normal text-text">{t('onboarding.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('onboarding.subtitle')}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate>
        <TextField
          label={t('onboarding.name')}
          required
          autoFocus
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={120}
          placeholder={t('onboarding.namePlaceholder')}
          error={errors.name}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label font-medium text-text">
            {t('onboarding.mode')}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ModeOption
              checked={solo}
              onChange={() => setSolo(true)}
              icon={<User className="size-4" aria-hidden />}
              title={t('onboarding.modeSolo')}
              body={t('onboarding.modeSoloBody')}
            />
            <ModeOption
              checked={!solo}
              onChange={() => setSolo(false)}
              icon={<Users className="size-4" aria-hidden />}
              title={t('onboarding.modeTeam')}
              body={t('onboarding.modeTeamBody')}
            />
          </div>
        </fieldset>

        <SelectField
          label={t('onboarding.country')}
          value={country}
          onChange={(e) => chooseCountry(e.target.value)}
          options={[
            ...COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
            { value: '', label: t('onboarding.countryOther') },
          ]}
          error={errors.country}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SelectField
            label={t('onboarding.currency')}
            required
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={currencies}
            error={errors.currency}
          />
          <SelectField
            label={t('onboarding.dateFormat')}
            required
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormat)}
            options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
            error={errors.dateFormat}
          />
        </div>
        <SelectField
          label={t('onboarding.timezone')}
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          options={timeZones}
          helper={t('onboarding.timezoneHelper')}
          error={errors.timezone}
        />

        {formError ? <Notice tone="danger">{formError}</Notice> : null}

        <Button type="submit" loading={create.isPending} className="w-full">
          {t('onboarding.submit')}
        </Button>
        <p className="text-center text-meta text-muted">{t('onboarding.trialNote')}</p>
      </form>
    </AuthLayout>
  );
}

function ModeOption({
  checked,
  onChange,
  icon,
  title,
  body,
}: {
  checked: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3 transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand',
        checked ? 'border-brand bg-brand-soft' : 'border-border-strong hover:bg-canvas',
      )}
    >
      <input type="radio" name="mode" className="sr-only" checked={checked} onChange={onChange} />
      <span
        className={cn(
          'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md',
          checked ? 'bg-brand text-white' : 'bg-canvas text-muted',
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-body font-semibold text-text">{title}</span>
        <span className="block text-meta text-muted">{body}</span>
      </span>
    </label>
  );
}

function OnboardingAside() {
  return (
    <div>
      <p className="text-meta font-semibold tracking-[0.05em] uppercase">
        {t('onboarding.asideOverline')}
      </p>
      <ol className="mt-4 flex flex-col gap-4 text-body">
        {[t('onboarding.step1'), t('onboarding.step2'), t('onboarding.step3')].map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-label font-semibold',
                i === 0 ? 'bg-white text-brand' : 'bg-sidebar-raised text-sidebar-text',
              )}
            >
              {i + 1}
            </span>
            <span className={cn('pt-1', i === 0 ? 'text-white' : null)}>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
