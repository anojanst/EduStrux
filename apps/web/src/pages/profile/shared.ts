import { useAuth } from '@clerk/react';
import { isClerkAPIResponseError, isReverificationCancelledError } from '@clerk/react/errors';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../i18n';
import { meKey } from '../../lib/session';

/** True when the user closed "Confirm it's you": nothing went wrong, so nothing is shown. */
export const wasCancelled = (error: unknown) => isReverificationCancelledError(error);

/**
 * What to tell the user when Clerk refuses a change: our words for the common cases, otherwise
 * Clerk's own (English) message, as on its sign-in screens (D-160).
 */
export function clerkMessage(error: unknown): string {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    if (first?.code === 'form_code_incorrect' || first?.code === 'verification_failed') {
      return t('code.incorrect');
    }
    if (first?.code === 'verification_expired') return t('code.expired');
    if (first?.code === 'form_password_incorrect') return t('security.password.wrongCurrent');
    if (first?.code === 'form_identifier_exists') return t('security.email.taken');
    if (first) return first.longMessage ?? first.message;
  }
  return t('error.generic');
}

/**
 * After a change to the name or primary email: a fresh session token carries it, the next API
 * call stores it in `users`, and the user's own lists show it (D-161).
 */
export function useRefreshIdentity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await getToken({ skipCache: true });
    await queryClient.invalidateQueries({ queryKey: meKey });
    void queryClient.invalidateQueries({ queryKey: ['staff'] });
  }, [getToken, queryClient]);
}

/** Seconds left before a code can be sent again, and a way to start the wait over. */
export function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, () => setLeft(seconds)] as const;
}
