import { useAuth } from '@clerk/react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageError, PageLoading } from '../components/PageState';
import { landingPath, lastOrg, useMe } from '../lib/session';

/** Pages for signed-in users only; anyone else goes to sign-in and comes back after. */
export function RequireSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  if (!isLoaded) return <PageLoading />;
  if (!isSignedIn) {
    const back = location.pathname + location.search;
    const to = back === '/' ? '/sign-in' : `/sign-in?redirect_url=${encodeURIComponent(back)}`;
    return <Navigate to={to} replace />;
  }
  return <Outlet />;
}

/** `/`: sends the user to their org, the org picker, or the welcome page. */
export function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return <PageLoading />;
  if (me.isError) return <PageError error={me.error} onRetry={() => void me.refetch()} />;
  return <Navigate to={landingPath(me.data.memberships, lastOrg())} replace />;
}

/** Sign-in and sign-up are for signed-out users; a signed-in one goes on to the app. */
export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <Navigate to="/" replace />;
  return children;
}
