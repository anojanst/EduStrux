import { Check } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** A button on a toast, such as "Download receipt" or "Undo". */
export type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; action?: ToastAction };
const ToastContext = createContext<(message: string, action?: ToastAction) => void>(() => {});

/** Tells the user an action finished (ui-design.md §6 Feedback). */
export function useToast() {
  return useContext(ToastContext);
}

/** Toasts bottom right (bottom centre on phones), each for 4 seconds, or 8 with a button. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((message: string, action?: ToastAction) => {
    const id = ++next.current;
    setToasts((list) => [...list, { id, message, action }]);
    // One with a button stays longer, so there's time to reach it.
    setTimeout(
      () => setToasts((list) => list.filter((toast) => toast.id !== id)),
      action ? 8000 : 4000,
    );
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-7 bottom-7 z-[80] flex flex-col items-end gap-2 max-md:right-auto max-md:bottom-[18px] max-md:left-1/2 max-md:-translate-x-1/2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="flex items-center gap-2.5 rounded-lg bg-[#173c3e] px-4 py-3 max-w-[calc(100vw-32px)] text-label font-semibold text-white sm:whitespace-nowrap shadow-[0_12px_30px_rgba(12,35,38,0.2)]"
          >
            <span className="grid size-[22px] place-items-center rounded-full bg-[#2d7064]">
              <Check className="size-3.5" aria-hidden />
            </span>
            {toast.message}
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  setToasts((list) => list.filter((other) => other.id !== toast.id));
                  toast.action!.onClick();
                }}
                className="pointer-events-auto -my-1 ml-1 rounded-md px-2 py-1 text-label font-semibold text-[#9fe0d0] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
