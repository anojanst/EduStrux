import { t } from '../i18n';
import { cn } from '../lib/cn';

/**
 * The logo mark and name; `markOnly` for the collapsed sidebar, with the name for screen readers.
 * `inverted` is for the sidebar: the mark sits on the active-pill colour, white on a dark theme.
 */
export function Logo({
  inverted = false,
  markOnly = false,
  className,
}: {
  inverted?: boolean;
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect
          width="64"
          height="64"
          rx="14"
          fill={inverted ? 'var(--sidebar-active)' : 'var(--brand)'}
        />
        <path
          d="M18 22h28M18 32h20M18 42h28"
          stroke={inverted ? 'var(--brand)' : '#ffffff'}
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      <span
        className={cn(
          'text-section font-semibold',
          inverted ? 'text-sidebar-strong' : 'text-text',
          markOnly && 'sr-only',
        )}
      >
        {t('app.name')}
      </span>
    </span>
  );
}
