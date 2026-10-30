import type { CreateOrg, Org } from '@edustrux/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../components/PageState';
import { Button } from '../components/ui/Button';
import { t } from '../i18n';
import { api, ApiError, fieldErrors } from '../lib/api';
import { localeFor } from '../lib/regions';
import { meKey, orgPath, rememberOrg } from '../lib/session';
import { DetailsFields, newDraft, TypeFields, type CentreDraft } from './setup/CentreSteps';
import { SETUP_STEPS, SetupLayout, StepFrame, type StepState } from './setup/SetupLayout';

/**
 * The first two steps of setting up a centre (TUI-130): its details, then solo or a team. The
 * second one's Continue makes the org with `POST /orgs` (its Main branch and the 14-day trial,
 * D-031, D-153) and opens the rest of the wizard inside it.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CentreDraft>(newDraft);
  const [step, setStep] = useState<'details' | 'type'>('details');
  const [nameError, setNameError] = useState<string | undefined>();

  const create = useMutation({
    mutationFn: (body: CreateOrg) => api<Org>('POST', '/orgs', { body }),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      rememberOrg(org.slug);
      navigate(`${orgPath(org.slug)}/setup?step=tax`, { replace: true });
    },
    // The fields that were refused are on the first step.
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(fieldErrors(error)).length) setStep('details');
    },
  });
  const errors = { ...fieldErrors(create.error), ...(nameError ? { name: nameError } : {}) };
  const formError =
    create.error && !Object.keys(fieldErrors(create.error)).length
      ? errorMessage(create.error)
      : null;

  const states = Object.fromEntries(
    SETUP_STEPS.map((s) => [
      s,
      s === step ? 'current' : s === 'details' ? 'done' : s === 'type' ? 'todo' : 'locked',
    ]),
  ) as Record<(typeof SETUP_STEPS)[number], StepState>;

  function next() {
    if (draft.name.trim().length < 2) {
      setNameError(t('setup.details.nameNeeded'));
      return;
    }
    setNameError(undefined);
    setStep('type');
  }

  function submit() {
    const slug = draft.slug.trim();
    create.mutate({
      name: draft.name.trim(),
      ...(slug.length >= 3 ? { slug } : {}),
      ...(draft.country ? { country: draft.country } : {}),
      currency: draft.currency,
      timezone: draft.timezone,
      locale: localeFor(draft.country),
      dateFormat: draft.dateFormat,
      singleTutorMode: draft.solo,
    });
  }

  const set = (change: Partial<CentreDraft>) => setDraft((d) => ({ ...d, ...change }));
  const continueButton = (loading = false) => (
    <Button type="submit" loading={loading}>
      {t('setup.continue')}
      <ArrowRight className="size-4" aria-hidden />
    </Button>
  );

  return (
    <SetupLayout
      step={step}
      states={states}
      onPick={(s) => (s === 'details' ? setStep('details') : s === 'type' ? next() : undefined)}
    >
      {step === 'details' ? (
        <StepFrame step="details" onSubmit={next} primary={continueButton()}>
          <DetailsFields draft={draft} onChange={set} creating errors={errors} />
        </StepFrame>
      ) : (
        <StepFrame
          step="type"
          back={() => setStep('details')}
          onSubmit={submit}
          error={formError}
          primary={continueButton(create.isPending)}
        >
          <TypeFields solo={draft.solo} onChange={(solo) => set({ solo })} />
          <p className="text-meta text-muted">{t('onboarding.trialNote')}</p>
        </StepFrame>
      )}
    </SetupLayout>
  );
}
