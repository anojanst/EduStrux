import { useId } from 'react';
import { cn } from '../../lib/cn';

/** An on/off switch with its label and a hint line, for a yes/no setting in a form. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 self-end py-1.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150',
          checked ? 'bg-brand' : 'bg-border-strong',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 left-0 size-5 rounded-full bg-white shadow-sm transition-transform duration-150',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <label htmlFor={id} className="flex flex-col">
        <b className="text-label font-semibold text-text">{label}</b>
        {hint ? (
          <small id={`${id}-hint`} className="text-meta text-muted">
            {hint}
          </small>
        ) : null}
      </label>
    </div>
  );
}
