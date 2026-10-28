import type { Org } from '@edustrux/shared';
import { DEFAULT_THEME, THEME_KEYS, type ThemeKey } from '@edustrux/shared/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { PageError, PageHeader, PageLoading, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t, type MessageKey } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import { can } from '../../lib/roles';
import { themeStyle } from '../../lib/theme';

/**
 * Settings › Theme (D-165): the owner picks one of the preset themes for the staff app, parent
 * portal, PDFs and emails, with a live preview, and saves it with `PATCH /orgs/{id}`.
 */
export function ThemePage() {
  const { membership, org } = useOrg();
  if (!can(membership.role, 'org:write')) {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  if (!org) return <PageLoading />;
  return <ThemeSettings org={org} />;
}

function ThemeSettings({ org }: { org: Org }) {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<ThemeKey>(org.theme);
  const dirty = picked !== org.theme;

  const save = useMutation({
    mutationFn: () =>
      api<Org>('PATCH', orgApiPath(membership), {
        body: { updatedAt: org.updatedAt, theme: picked },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', membership.org.id], updated);
      toast(t('theme.saved'));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'stale_data';

  const reload = async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['org', membership.org.id],
      queryFn: () => api<Org>('GET', orgApiPath(membership)),
      staleTime: 0,
    });
    setPicked(fresh.theme);
    save.reset();
  };

  return (
    <div className="pb-20 md:pb-0">
      <PageHeader
        overline={t('theme.overline')}
        title={t('theme.title')}
        subtitle={t('theme.subtitle')}
      />
      {save.error ? (
        <Notice
          tone={stale ? 'warning' : 'danger'}
          className="mb-5"
          action={
            stale ? (
              <Button variant="secondary" size="sm" onClick={() => void reload()}>
                {t('theme.reload')}
              </Button>
            ) : null
          }
        >
          {errorMessage(save.error)}
        </Notice>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]">
        <div>
          <Card className="sm:p-5">
            <h2 className="mb-4 text-section font-medium text-text">{t('theme.themes')}</h2>
            <ThemeGrid value={picked} onChange={setPicked} />
          </Card>
          <div
            className={cn(
              'flex items-center justify-end gap-2',
              'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-sm:bottom-[calc(66px+env(safe-area-inset-bottom))] max-md:z-30 max-md:min-h-16 max-md:border-t max-md:border-border max-md:bg-surface max-md:px-4 max-md:py-2.5',
              'md:mt-3 md:min-h-[68px] md:py-3',
            )}
          >
            {dirty ? (
              <span className="mr-auto text-meta text-muted max-md:hidden">
                {t('theme.unsaved')}
              </span>
            ) : null}
            <Button
              variant="secondary"
              className="max-md:hidden"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setPicked(org.theme);
                save.reset();
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="max-md:w-full"
              disabled={!dirty && !save.isPending}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {t('theme.save')}
            </Button>
          </div>
        </div>
        <Preview theme={picked} orgName={org.name} currency={org.currency} />
      </div>
    </div>
  );
}

/** The themes as a radio group: arrow keys move the choice, Tab leaves the group. */
function ThemeGrid({ value, onChange }: { value: ThemeKey; onChange: (key: ThemeKey) => void }) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + THEME_KEYS.length) % THEME_KEYS.length;
    onChange(THEME_KEYS[next]!);
    tiles.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.groupLabel')}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-2 xl:grid-cols-4"
    >
      {THEME_KEYS.map((key, index) => {
        const selected = key === value;
        const name = t(`theme.name.${key}` as MessageKey);
        return (
          <button
            key={key}
            ref={(el) => {
              tiles.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            style={themeStyle(key)}
            className={cn(
              'relative min-w-0 rounded-xl bg-surface text-left text-text transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              selected
                ? 'border-2 border-brand p-[7px]'
                : 'border border-border p-2 hover:border-border-strong',
            )}
          >
            <span
              aria-hidden
              className="grid h-[68px] grid-cols-[30%_70%] overflow-hidden rounded-lg border border-border bg-surface sm:h-[78px]"
            >
              <span className="flex flex-col gap-1.5 border-r border-black/5 bg-sidebar px-[5px] py-2.5">
                <i className="h-[5px] rounded-[3px] bg-sidebar-text opacity-55" />
                <i className="h-2.5 rounded-[3px] bg-sidebar-active" />
                <i className="h-[5px] rounded-[3px] bg-sidebar-text opacity-55" />
              </span>
              <span className="flex flex-col items-start gap-2 px-2 py-3">
                <i className="h-3 w-[62%] rounded bg-brand" />
                <i className="h-2.5 w-[48%] rounded bg-brand-soft" />
                <i className="h-1 w-[78%] rounded bg-border" />
              </span>
            </span>
            {selected ? (
              <span className="absolute top-1 right-1 grid size-[22px] place-items-center rounded-full border-2 border-white bg-brand text-white sm:top-[5px] sm:right-[5px]">
                <Check className="size-[13px]" strokeWidth={1.8} aria-hidden />
              </span>
            ) : null}
            <span className="mt-2 block truncate text-body font-semibold">{name}</span>
            {key === DEFAULT_THEME ? (
              <small className="block text-meta text-muted">{t('theme.default')}</small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** What the picked theme looks like where it shows: the staff app, the portal, and paper. */
function Preview({
  theme,
  orgName,
  currency,
}: {
  theme: ThemeKey;
  orgName: string;
  currency: string;
}) {
  const fmt = useFormat();
  const style = themeStyle(theme);
  const chip = 'rounded-[5px] bg-brand px-[7px] py-[5px] text-meta text-white';

  return (
    <Card className="sm:p-5 lg:sticky lg:top-[88px]">
      <h2 className="text-section font-medium text-text">{t('theme.preview')}</h2>
      <div aria-hidden>
        <PreviewBlock label={t('theme.preview.staff')} style={style}>
          <div className="grid grid-cols-[30%_70%] overflow-hidden rounded-lg border border-border bg-canvas">
            <div className="flex flex-col gap-2 border-r border-black/5 bg-sidebar px-2 py-3.5">
              <i className="h-[7px] rounded bg-sidebar-text opacity-50" />
              <i className="h-3.5 rounded bg-sidebar-active" />
              <i className="h-[7px] rounded bg-sidebar-text opacity-50" />
            </div>
            <div className="min-w-0">
              <div className="h-[25px] border-b border-border bg-surface" />
              <div className="m-2.5 grid grid-cols-[1fr_auto] gap-[7px] rounded-lg border border-border bg-surface p-2.5">
                <b className="col-span-2 text-meta font-semibold text-text">
                  {t('theme.preview.lessons')}
                </b>
                <span className="col-span-2 rounded bg-brand-soft p-[5px] text-meta text-brand">
                  {t('theme.preview.class')}
                </span>
                <span className={cn(chip, 'justify-self-start')}>
                  {t('theme.preview.viewClass')}
                </span>
                <span className="self-center text-meta text-brand underline">
                  {t('theme.preview.timetable')}
                </span>
              </div>
            </div>
          </div>
        </PreviewBlock>

        <PreviewBlock label={t('theme.preview.portal')} style={style} className="max-md:hidden">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
            <b className="text-body font-semibold text-text">{t('theme.preview.hi')}</b>
            <small className="text-meta text-muted">{t('theme.preview.nextLesson')}</small>
            <span className="text-meta text-muted">{t('theme.preview.lesson')}</span>
            <div className="mt-[7px] flex items-center justify-between border-t border-border pt-[9px]">
              <span className="flex flex-col gap-[3px]">
                <b className="text-meta font-semibold text-text">{t('theme.preview.invoiceDue')}</b>
                <small className="text-meta text-muted">
                  {t('theme.preview.due', {
                    amount: fmt.money({ amount: 45000, currency }),
                  })}
                </small>
              </span>
              <span className={chip}>{t('theme.preview.payNow')}</span>
            </div>
          </div>
        </PreviewBlock>

        <PreviewBlock label={t('theme.preview.docs')} style={style} className="max-md:hidden">
          <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-lg border border-border p-3">
            <b className="min-w-0 truncate text-body font-semibold text-brand">{orgName}</b>
            <span className="text-meta text-muted">{t('theme.preview.invoice')}</span>
            <hr className="col-span-2 border-border" />
            <small className="col-span-2 text-meta text-muted">{t('theme.preview.email')}</small>
            <span className="text-meta text-brand underline">
              {t('theme.preview.viewYourInvoice')}
            </span>
            <span className={chip}>{t('theme.preview.viewInvoice')}</span>
          </div>
        </PreviewBlock>
      </div>
    </Card>
  );
}

function PreviewBlock({
  label,
  style,
  className,
  children,
}: {
  label: string;
  style: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('mt-4', className)} style={style}>
      <p className="mb-2 text-meta font-semibold tracking-[0.05em] text-muted uppercase">{label}</p>
      {children}
    </div>
  );
}
