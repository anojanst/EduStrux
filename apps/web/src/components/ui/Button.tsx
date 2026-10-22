import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

const variants = {
  primary: 'bg-brand text-white font-semibold hover:bg-brand-hover active:bg-brand-hover',
  secondary:
    'bg-surface text-secondary-text border border-border-strong hover:bg-canvas active:bg-canvas',
  ghost: 'text-brand hover:bg-brand-soft',
  danger: 'bg-danger text-white font-semibold hover:opacity-90',
  dangerOutline:
    'bg-surface text-danger font-semibold border border-[#d88d8d] hover:bg-danger-soft',
} as const;

const sizes = {
  md: 'h-11 sm:h-10 px-4 gap-2',
  sm: 'h-8 px-3 gap-1.5',
  icon: 'size-11 sm:size-9 justify-center',
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
};

/** ui-design.md §6 Buttons. Loading shows a spinner in place of the icon and keeps the width. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg text-label font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** A link styled as a button (same variants), for navigation that looks like an action. */
export function buttonClass(
  variant: keyof typeof variants = 'primary',
  size: keyof typeof sizes = 'md',
) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-lg text-label font-medium transition-colors duration-150 ease-out',
    variants[variant],
    sizes[size],
  );
}
