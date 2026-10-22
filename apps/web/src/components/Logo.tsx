import { t } from '../i18n';
import { cn } from '../lib/cn';

export function Logo({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill={inverted ? '#ffffff' : '#155d63'} />
        <path
          d="M18 22h28M18 32h20M18 42h28"
          stroke={inverted ? '#155d63' : '#ffffff'}
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      <span className={cn('text-section font-semibold', inverted ? 'text-white' : 'text-text')}>
        {t('app.name')}
      </span>
    </span>
  );
}
