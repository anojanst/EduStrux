import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * White card with a 1px border, 12px radius, no shadow (ui-design.md §4). `flush` leaves out the
 * padding, for cards whose rows run edge to edge or set their own.
 */
export function Card({
  className,
  flush = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface',
        flush ? null : 'p-4 sm:p-5',
        className,
      )}
      {...props}
    />
  );
}
