import { t } from '../i18n';
import { cn } from '../lib/cn';

/** A bar of the mark: 9 wide, standing on y = 26, rounded 3 on top and 1 at the foot. */
function bar(x: number, height: number) {
  const top = 26 - height;
  return `M${x} ${top + 3}a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3V25a1 1 0 0 1-1 1H${x + 1}a1 1 0 0 1-1-1Z`;
}

/** Each bar leans like the others: skewed 25° up to the right about its own middle. */
function lean(x: number, height: number) {
  const cx = x + 4.5;
  const cy = 26 - height / 2;
  return `translate(${cx} ${cy}) skewY(-25) translate(${-cx} ${-cy})`;
}

const BARS = [
  { x: 0, height: 12, tall: false, opacity: 0.65 },
  { x: 10, height: 20, tall: false, opacity: 1 },
  { x: 20, height: 27, tall: true, opacity: 1 },
];

/**
 * The logo (TUI-135, from the owner's Figma Make design): three rising bars that lean up to the
 * right, and "EduStrux" in Manrope ExtraBold. `inverted` is for the sidebar and other dark
 * panels: the tall bar in the sidebar's strong colour, the others the theme's `logoAccent`; on light
 * backgrounds the tall bar is ink and the others the brand. `markOnly` keeps the name for screen
 * readers, for the collapsed sidebar.
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
  const accent = inverted ? 'var(--logo-accent)' : 'var(--brand)';
  const tall = inverted ? 'var(--sidebar-strong)' : 'var(--text)';
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 -4 29 33" className="h-8 w-7 shrink-0" aria-hidden>
        {BARS.map((b) => (
          <path
            key={b.x}
            d={bar(b.x, b.height)}
            transform={lean(b.x, b.height)}
            fill={b.tall ? tall : accent}
            opacity={b.opacity}
          />
        ))}
      </svg>
      <span
        className={cn(
          'font-brand text-[19px] font-extrabold tracking-[-0.4px]',
          inverted ? 'text-sidebar-strong' : 'text-text',
          markOnly && 'sr-only',
        )}
      >
        {t('app.name')}
      </span>
    </span>
  );
}
