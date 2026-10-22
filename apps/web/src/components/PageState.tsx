import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { ApiError } from '../lib/api';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

/** The first load of a page, before there's anything to draw a skeleton of. */
export function PageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted">
      <Spinner className="size-6" label={t('common.loading')} />
    </div>
  );
}

/** A message for an error answer, by its stable code (D-015). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network') return t('error.network');
    if (error.status === 403) return t('error.forbidden');
    if (error.status === 404) return t('error.notFound');
    if (error.code === 'subscription_required') return t('error.subscriptionRequired');
    if (error.code === 'stale_data') return t('error.staleData');
    if (error.status === 429) return t('error.rateLimited');
  }
  return t('error.generic');
}

export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="max-w-sm text-body text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** ui-design.md §5 page header: overline, title, one muted line, and an action on the right. */
export function PageHeader({
  overline,
  title,
  subtitle,
  action,
}: {
  overline?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {overline ? (
          <p className="text-meta font-semibold tracking-[0.05em] text-muted uppercase">
            {overline}
          </p>
        ) : null}
        <h1 className="mt-1 text-title font-normal text-text">{title}</h1>
        {subtitle ? <p className="mt-1 text-body text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
