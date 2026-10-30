import { Check, ChevronLeft } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import { t, type MessageKey } from '../../i18n';
import { cn } from '../../lib/cn';

export const SETUP_STEPS = [
  'details',
  'type',
  'tax',
  'branch',
  'calendar',
  'grades',
  'subjects',
  'team',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type StepState = 'done' | 'current' | 'todo' | 'locked';

/**
 * The setup wizard's full screen (TUI-130, from the owner's Figma Make design): a dark panel in
 * the theme's sidebar colours with the eight steps, and the step's form beside it. On phones the
 * panel is a bar with the step count and a progress line.
 */
export function SetupLayout({
  step,
  states,
  onPick,
  children,
}: {
  step: SetupStep;
  states: Record<SetupStep, StepState>;
  onPick: (step: SetupStep) => void;
  children: ReactNode;
}) {
  const index = SETUP_STEPS.indexOf(step);
  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-text lg:sticky lg:top-0 lg:h-dvh lg:w-[340px] lg:p-8">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:p-0">
          <Logo inverted />
          <span className="text-meta font-semibold text-sidebar-strong lg:hidden">
            {t('setup.count', { n: index + 1, total: SETUP_STEPS.length })}
          </span>
        </div>
        <div className="h-1 bg-sidebar-raised lg:hidden">
          <div
            className="h-full bg-sidebar-active transition-[width] duration-200"
            style={{ width: `${((index + 1) / SETUP_STEPS.length) * 100}%` }}
          />
        </div>
        <div className="mt-16 hidden lg:block">
          <p className="text-meta font-semibold tracking-[0.08em] text-sidebar-active uppercase">
            {t('setup.panel.overline')}
          </p>
          <h1 className="mt-2 text-title font-normal text-sidebar-strong">
            {t('setup.panel.title')}
          </h1>
          <p className="mt-2 text-meta">{t('setup.panel.subtitle')}</p>
        </div>
        <nav aria-label={t('setup.steps')} className="mt-8 hidden lg:block">
          <ol className="flex flex-col">
            {SETUP_STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={states[s] === 'locked'}
                  onClick={() => onPick(s)}
                  aria-current={states[s] === 'current' ? 'step' : undefined}
                  className="group flex min-h-11 w-full items-center gap-3 rounded-lg py-1.5 text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-meta font-semibold',
                      states[s] === 'done' &&
                        'border-transparent bg-sidebar-raised text-sidebar-active',
                      states[s] === 'current' && 'border-transparent bg-sidebar-active text-brand',
                      (states[s] === 'todo' || states[s] === 'locked') &&
                        'border-sidebar-text/40 text-sidebar-text',
                    )}
                  >
                    {states[s] === 'done' ? (
                      <Check className="size-3.5" aria-label={t('setup.stepDone')} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span
                      className={cn(
                        'text-label font-semibold',
                        states[s] === 'current' || states[s] === 'done'
                          ? 'text-sidebar-strong'
                          : 'text-sidebar-text',
                        states[s] !== 'locked' && 'group-hover:underline',
                      )}
                    >
                      {t(`setup.${s}.nav` as MessageKey)}
                    </span>
                    {states[s] === 'current' ? (
                      <span className="text-meta text-sidebar-active">{t('setup.inProgress')}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-[600px]">{children}</div>
      </main>
    </div>
  );
}

/** A step's heading, its form and the footer: Back on the left, Skip and the step's button. */
export function StepFrame({
  step,
  back,
  skip,
  primary,
  error,
  onSubmit,
  children,
}: {
  step: SetupStep;
  back?: () => void;
  skip?: () => void;
  primary: ReactNode;
  error?: string | null;
  onSubmit?: () => void;
  children: ReactNode;
}) {
  const index = SETUP_STEPS.indexOf(step);
  return (
    <form
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <p className="text-meta font-semibold tracking-[0.08em] text-brand uppercase">
        {t('setup.count', { n: index + 1, total: SETUP_STEPS.length })}
      </p>
      <h2 className="mt-2 text-[28px] leading-tight font-normal text-text sm:text-[32px]">
        {t(`setup.${step}.title` as MessageKey)}
      </h2>
      <p className="mt-2 text-body text-muted">{t(`setup.${step}.subtitle` as MessageKey)}</p>
      <div className="mt-8 flex flex-col gap-5">{children}</div>
      {error ? (
        <Notice tone="danger" className="mt-5">
          {error}
        </Notice>
      ) : null}
      <div className="mt-8 flex flex-col-reverse gap-2 border-t border-border pt-6 sm:flex-row sm:items-center">
        {back ? (
          <Button variant="secondary" icon={<ChevronLeft className="size-4" />} onClick={back}>
            {t('setup.back')}
          </Button>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center">
          {skip ? (
            <Button variant="ghost" onClick={skip}>
              {t('setup.skip')}
            </Button>
          ) : null}
          {primary}
        </div>
      </div>
    </form>
  );
}

/** A choice card with an icon or a radio dot, for one of the ways a step can go. */
export function ChoiceCard({
  name,
  checked,
  onChange,
  title,
  body,
  icon,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand',
        icon ? 'flex-col' : 'items-center',
        checked
          ? 'border-brand bg-brand-soft/60'
          : 'border-border-strong bg-surface hover:bg-canvas',
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      {icon ? (
        <>
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
            {icon}
          </span>
          <span
            aria-hidden
            className={cn(
              'absolute top-4 right-4 inline-flex size-5 items-center justify-center rounded-full border',
              checked ? 'border-brand bg-brand text-white' : 'border-border-strong',
            )}
          >
            {checked ? <Check className="size-3" /> : null}
          </span>
        </>
      ) : (
        <span
          aria-hidden
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2',
            checked ? 'border-brand' : 'border-border-strong',
          )}
        >
          {checked ? <span className="size-2.5 rounded-full bg-brand" /> : null}
        </span>
      )}
      <span className="flex flex-col gap-0.5">
        <span className="text-body font-semibold text-text">{title}</span>
        <span className="text-meta text-muted">{body}</span>
      </span>
    </label>
  );
}

/** A suggestion chip that toggles, with a check when picked. */
export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-body transition-colors duration-150',
        pressed
          ? 'border-brand bg-brand-soft/60 font-semibold text-brand'
          : 'border-border-strong bg-surface text-text hover:bg-canvas',
      )}
    >
      {pressed ? <Check className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** The step's illustration tile, as in the design: an icon on the brand tint. */
export function StepIcon({ children }: { children: ReactNode }) {
  return (
    <span className="mx-auto inline-flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand [&>svg]:size-7">
      {children}
    </span>
  );
}
