import { cn } from '../../lib/cn';

/** Up to two initials from a name, or the first letter of an email. */
export function initials(name: string | null | undefined, fallback = '?') {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback.slice(0, 1).toUpperCase();
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  fallback,
  tone = 'brand',
  className,
}: {
  name: string | null | undefined;
  fallback?: string;
  tone?: 'brand' | 'org';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-label font-semibold',
        tone === 'org' ? 'bg-org-avatar text-org-avatar-text' : 'bg-brand-soft text-brand',
        className,
      )}
    >
      {initials(name, fallback)}
    </span>
  );
}
