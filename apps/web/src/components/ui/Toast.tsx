import { Check } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; message: string };
const ToastContext = createContext<(message: string) => void>(() => {});

/** Tells the user an action finished (ui-design.md §6 Feedback). */
export function useToast() {
  return useContext(ToastContext);
}

/** Toasts bottom right (bottom centre on phones), each for 4 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((message: string) => {
    const id = ++next.current;
    setToasts((list) => [...list, { id, message }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 4000);
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
            className="flex items-center gap-2.5 rounded-lg bg-[#173c3e] px-4 py-3 text-label font-semibold whitespace-nowrap text-white shadow-[0_12px_30px_rgba(12,35,38,0.2)]"
          >
            <span className="grid size-[22px] place-items-center rounded-full bg-[#2d7064]">
              <Check className="size-3.5" aria-hidden />
            </span>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
