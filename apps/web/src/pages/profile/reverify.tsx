import { useReverification, useSession } from '@clerk/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { Dialog } from '../../components/ui/Dialog';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { t } from '../../i18n';
import { clerkMessage, useCountdown } from './shared';

type Pending = {
  complete: () => void;
  cancel: () => void;
  level: 'first_factor' | 'second_factor' | 'multi_factor' | undefined;
};

const ReverifyContext = createContext<(pending: Pending) => void>(() => {});

/**
 * A change Clerk counts as sensitive (adding or removing an email, deleting the account). When Clerk wants fresh proof of who this is, our "Confirm it's you" dialog asks for
 * it, then Clerk runs the change again. When it doesn't, the change just runs.
 */
// Any async function, as Clerk's own hook takes.
export function useSensitive<Fn extends (...args: any[]) => Promise<any>>(fn: Fn) {
  const request = useContext(ReverifyContext);
  return useReverification(fn, { onNeedsReverification: request });
}

/** Holds the one "Confirm it's you" dialog the profile page's sensitive changes share. */
export function ReverifyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  return (
    <ReverifyContext.Provider value={setPending}>
      {children}
      <ReverifyDialog pending={pending} onDone={() => setPending(null)} />
    </ReverifyContext.Provider>
  );
}

type Factor = { strategy: string; emailAddressId?: string; safeIdentifier?: string };
type Step =
  | { kind: 'starting' }
  | { kind: 'code'; emailAddressId: string; to: string }
  | { kind: 'unavailable' };

function ReverifyDialog({ pending, onDone }: { pending: Pending | null; onDone: () => void }) {
  const { session } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, restartResend] = useCountdown(30);

  // A new request starts over: Clerk says which ways of proving it it accepts. Everyone signs in
  // with an emailed code (D-192), so that's the one asked for.
  useEffect(() => {
    if (!pending || !session) return;
    let live = true;
    setStep({ kind: 'starting' });
    setCode('');
    setError(null);
    void (async () => {
      try {
        const verification = await session.startVerification({
          level: pending.level ?? 'first_factor',
        });
        const factors = (verification.supportedFirstFactors ?? []) as Factor[];
        const email = factors.find((f) => f.strategy === 'email_code' && f.emailAddressId);
        if (!live) return;
        if (email?.emailAddressId) {
          await session.prepareFirstFactorVerification({
            strategy: 'email_code',
            emailAddressId: email.emailAddressId,
          });
          if (!live) return;
          restartResend();
          setStep({
            kind: 'code',
            emailAddressId: email.emailAddressId,
            to: email.safeIdentifier ?? '',
          });
        } else {
          setStep({ kind: 'unavailable' });
        }
      } catch (err) {
        if (live) {
          setError(clerkMessage(err));
          setStep({ kind: 'unavailable' });
        }
      }
    })();
    return () => {
      live = false;
    };
    // Runs once per request; restartResend only resets a counter.
  }, [pending, session]);

  function cancel() {
    pending?.cancel();
    onDone();
  }

  async function confirm() {
    if (!session || !pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.attemptFirstFactorVerification({ strategy: 'email_code', code });
      if (result.status === 'complete') {
        pending.complete();
        onDone();
      } else {
        setError(t('reverify.needsTwoStep'));
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!session || step.kind !== 'code') return;
    setError(null);
    try {
      await session.prepareFirstFactorVerification({
        strategy: 'email_code',
        emailAddressId: step.emailAddressId,
      });
      restartResend();
    } catch (err) {
      setError(clerkMessage(err));
    }
  }

  const ready = step.kind === 'code' && code.length === 6;

  return (
    <Dialog
      open={pending !== null}
      onClose={cancel}
      title={t('reverify.title')}
      actions={
        <>
          <Button variant="secondary" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void confirm()} loading={busy} disabled={!ready}>
            {t('common.continue')}
          </Button>
        </>
      }
    >
      {step.kind === 'starting' ? (
        <div className="flex items-center gap-2 text-body text-muted">
          <Spinner /> {t('reverify.sending')}
        </div>
      ) : step.kind === 'code' ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-muted">{t('reverify.codeIntro', { email: step.to })}</p>
          <CodeInput value={code} onChange={setCode} invalid={error !== null} />
          {error ? <p className="text-meta text-danger">{error}</p> : null}
          <ResendButton left={resendIn} onResend={() => void resend()} />
        </div>
      ) : (
        <Notice tone="danger">{error ?? t('reverify.unavailable')}</Notice>
      )}
    </Dialog>
  );
}

/** "Resend code", or how long until it can be sent again. */
export function ResendButton({ left, onResend }: { left: number; onResend: () => void }) {
  return (
    <button
      type="button"
      disabled={left > 0}
      onClick={onResend}
      className="self-start text-label font-semibold text-brand disabled:font-normal disabled:text-muted"
    >
      {left > 0 ? t('code.resendIn', { seconds: left }) : t('code.resend')}
    </button>
  );
}
