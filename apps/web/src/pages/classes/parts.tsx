import type { Class, ScheduleSlot } from '@edustrux/shared';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../../components/ui/Card';
import { t } from '../../i18n';
import { sortSlots } from '../../lib/classes';
import { cn } from '../../lib/cn';
import type { useFormat } from '../../lib/format';

type Format = ReturnType<typeof useFormat>;

/**
 * "Tue & Thu 4:00–5:00 pm, Sat 10:00–11:30 am": the weekly slots, with the days that share a
 * time together. Empty when the class has no schedule yet.
 */
export function scheduleLabel(slots: ScheduleSlot[], format: Format) {
  const byTime = new Map<string, number[]>();
  for (const slot of sortSlots(slots)) {
    const key = format.timeRange(slot.startTime, slot.endTime);
    byTime.set(key, [...(byTime.get(key) ?? []), slot.weekday]);
  }
  return [...byTime]
    .map(([time, days]) =>
      t('classes.slot', { days: days.map((d) => format.weekday(d)).join(' & '), time }),
    )
    .join(', ');
}

/** "9 / 12" with a bar that turns amber when the class is full; "9" when it has no limit. */
export function Capacity({ klass, className }: { klass: Class; className?: string }) {
  const { enrolledCount: n, capacity } = klass;
  const full = capacity !== null && n >= capacity;
  return (
    <span className={cn('flex w-[84px] shrink-0 flex-col gap-1', className)}>
      <span
        className={cn('text-body font-semibold tabular-nums', full ? 'text-warning' : 'text-text')}
      >
        {capacity === null ? n : t('classes.capacity', { n, capacity })}
        <span className="sr-only"> {full ? t('classes.full') : t('classes.enrolledLabel')}</span>
      </span>
      {capacity !== null ? (
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-border">
          <span
            className={cn('block h-full rounded-full', full ? 'bg-warning' : 'bg-brand')}
            style={{ width: `${Math.min(100, Math.round((n / capacity) * 100))}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

const tiles = {
  brand: 'bg-brand-soft text-brand',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

/** ui-design.md §6 Stat card: label and icon tile, the value, then one supporting line. */
export function StatCard({
  label,
  Icon,
  value,
  note,
  tone = 'brand',
  className,
}: {
  label: string;
  Icon: LucideIcon;
  value: ReactNode;
  note?: ReactNode;
  tone?: keyof typeof tiles;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-body text-muted">{label}</span>
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tiles[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <strong className="text-stat font-bold text-text tabular-nums">{value}</strong>
      {note ? <span className="text-meta text-muted">{note}</span> : null}
    </Card>
  );
}
