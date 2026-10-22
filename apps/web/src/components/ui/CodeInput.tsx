import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';

const LENGTH = 6;

/**
 * Six boxes for a 6-digit code: typing moves on, Backspace moves back, and pasting the whole
 * code fills every box. `value` is the digits typed so far.
 */
export function CodeInput({
  value,
  onChange,
  invalid = false,
  autoFocus = true,
}: {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  function set(i: number, digit: string) {
    const next = digits.slice();
    next[i] = digit;
    onChange(next.join('').slice(0, LENGTH));
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    focus(pasted.length);
  }

  function key(i: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[i] && i > 0) {
      event.preventDefault();
      set(i - 1, '');
      focus(i - 1);
    } else if (event.key === 'ArrowLeft') focus(i - 1);
    else if (event.key === 'ArrowRight') focus(i + 1);
  }

  return (
    <div role="group" aria-label={t('code.label')} className="grid grid-cols-6 gap-1.5 md:gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          aria-label={t('code.digit', { n: i + 1 })}
          aria-invalid={invalid || undefined}
          value={digit}
          onPaste={paste}
          onKeyDown={(e) => key(i, e)}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '').slice(-1);
            set(i, typed);
            if (typed) focus(i + 1);
          }}
          className={cn(
            'h-[46px] w-full min-w-0 rounded-lg border bg-surface text-center text-[18px] font-semibold text-text md:aspect-square md:h-auto',
            'focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] focus:outline-none',
            invalid ? 'border-danger' : 'border-border-strong',
          )}
        />
      ))}
    </div>
  );
}
