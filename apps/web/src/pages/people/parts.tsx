import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';
import { cn } from '../../lib/cn';

/** A card with a 54px heading row and its rows below, edge to edge (the design's detail card). */
export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card flush className={cn('overflow-hidden', className)}>
      <div className="flex min-h-[54px] items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-section font-medium text-text">{title}</h2>
          {subtitle ? <p className="text-meta text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A line inside a card when it has nothing to list. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-body text-muted">{children}</p>;
}

/** The empty or no-results state of a list: an icon, one sentence and the next action. */
export function EmptyState({
  Icon,
  title,
  body,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-3.5 text-section font-medium text-text">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-body text-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A detail page's header: a link back up as the overline, the title, one muted line, and the
 * page's actions on the right (below on phones).
 */
export function DetailHeader({
  back,
  title,
  meta,
  actions,
}: {
  back: { to: string; label: string };
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <Link
          to={back.to}
          className="inline-flex items-center gap-1 text-meta font-semibold tracking-[0.05em] text-brand uppercase hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
        <h1 className="mt-1 text-title font-normal break-words text-text">{title}</h1>
        {meta ? <div className="mt-1 text-body text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Skeleton rows while a list loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex h-[52px] items-center gap-3 px-4">
          <span className="h-4 w-40 animate-pulse rounded bg-canvas" />
          <span className="h-3 w-24 animate-pulse rounded bg-canvas" />
        </li>
      ))}
    </ul>
  );
}
