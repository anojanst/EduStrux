import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

const tones = {
  info: { box: 'bg-info-soft text-info', Icon: Info },
  success: { box: 'bg-success-soft text-success', Icon: CircleCheck },
  warning: { box: 'bg-warning-soft text-warning', Icon: TriangleAlert },
  danger: { box: 'bg-danger-soft text-danger', Icon: CircleAlert },
} as const;

/** A soft-tinted message with its icon: colour never carries the meaning alone. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = tones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-lg px-4 py-3', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-body">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title ? 'mt-0.5' : null, 'text-text')}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
