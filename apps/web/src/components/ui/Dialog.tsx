import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';

/**
 * A modal dialog (ui-design.md §6 Feedback): the browser's own <dialog>, which traps focus and
 * closes on Escape. Centred on wide screens, a bottom sheet on phones. The body mounts only while
 * open, so each opening starts fresh. `wide` is for forms with sections (640px); a body taller
 * than the screen scrolls between the fixed title and actions.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  subtitle,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  subtitle?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Opening focuses the first button, the close one; a form starts at its first field.
      dialog.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-32px)] flex-col rounded-xl bg-surface p-0 text-text shadow-pop backdrop:bg-[rgba(12,26,28,0.48)] open:flex max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none',
        wide ? 'w-[min(640px,calc(100%-32px))]' : 'w-[min(440px,calc(100%-32px))]',
      )}
    >
      {open ? (
        <>
          <div className="flex min-h-[62px] shrink-0 items-center justify-between gap-3 border-b border-border px-5">
            <div className="min-w-0 py-3">
              <h2 id={titleId} className="text-section font-medium">
                {title}
              </h2>
              {subtitle ? <p className="mt-0.5 text-meta text-muted">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-canvas"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-[18px] py-5 md:p-[22px]">{children}</div>
          {actions ? (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-[18px] pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] md:px-5 md:pb-3.5 max-md:[&>*]:flex-1">
              {actions}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
