import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** Room a menu item takes, to tell whether the menu fits below its button. */
const ITEM_HEIGHT = 44;

/**
 * The "…" button with a small menu of row actions. Closes on Escape, a click outside, scrolling
 * or resizing. The menu is placed against the window, not its row, so a card that clips its
 * rounded corners can't cut it off; it opens upwards when there's no room below.
 */
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = place !== null;

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setPlace(null);
      } else if (event.type !== 'mousedown' || !ref.current?.contains(event.target as Node)) {
        setPlace(null);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open || !button.current) {
      setPlace(null);
      return;
    }
    const rect = button.current.getBoundingClientRect();
    const height = items.length * ITEM_HEIGHT + 8;
    const below = window.innerHeight - rect.bottom >= height + 8;
    setPlace({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="grid size-11 place-items-center rounded-lg text-muted hover:bg-canvas md:size-10"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {place ? (
        <div
          role="menu"
          style={place}
          className="fixed z-40 w-[200px] rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setPlace(null);
                item.onSelect();
              }}
              className={cn(
                'flex h-11 w-full items-center rounded-md px-2.5 text-left text-body hover:bg-canvas md:h-9',
                item.danger ? 'text-danger' : 'text-text',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
