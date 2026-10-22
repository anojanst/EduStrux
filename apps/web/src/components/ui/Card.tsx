import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** White card with a 1px border, 12px radius, no shadow (ui-design.md §4). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface p-4 sm:p-5', className)}
      {...props}
    />
  );
}
