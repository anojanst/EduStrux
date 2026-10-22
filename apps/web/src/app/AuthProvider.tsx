import { ClerkProvider, useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { setTokenGetter } from '../lib/api';
import { clerkAppearance } from './clerkAppearance';

/**
 * Clerk for sign-in and sessions only (handoff §3): who the user is. Their orgs and roles come
 * from `GET /me`. Clerk navigates through the router so sign-in steps don't reload the page.
 */
export function AuthProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={clerkAppearance}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/onboarding"
      afterSignOutUrl="/sign-in"
    >
      <SessionBridge>{children}</SessionBridge>
    </ClerkProvider>
  );
}

/**
 * Hands Clerk's token to the API client, and drops every cached answer when the signed-in user
 * changes, so one person never sees another's data after a sign-out on a shared device.
 */
function SessionBridge({ children }: { children: ReactNode }) {
  const { getToken, userId, isLoaded } = useAuth();
  const queryClient = useQueryClient();
  const lastUser = useRef<string | null | undefined>(undefined);

  // Set during render, before any child's query runs.
  setTokenGetter(() => getToken());

  useEffect(() => {
    if (!isLoaded) return;
    if (lastUser.current !== undefined && lastUser.current !== userId) queryClient.clear();
    lastUser.current = userId ?? null;
  }, [isLoaded, userId, queryClient]);

  return children;
}
