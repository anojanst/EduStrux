import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Outlet } from 'react-router';
import { ToastProvider } from '../components/ui/Toast';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { useOrg } from '../lib/org';
import { HomePage } from '../pages/HomePage';
import { ChooseOrgPage } from '../pages/ChooseOrgPage';
import { ClassesPage } from '../pages/classes/ClassesPage';
import { CoursesPage } from '../pages/courses/CoursesPage';
import { ClassPage } from '../pages/classes/ClassPage';
import { LessonPage } from '../pages/classes/LessonPage';
import { InvoicePage } from '../pages/billing/InvoicePage';
import { InvoicesPage } from '../pages/billing/InvoicesPage';
import { PaymentsPage } from '../pages/billing/PaymentsPage';
import { InvitationPage } from '../pages/InvitationPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { FamilyPage } from '../pages/people/FamilyPage';
import { PeoplePage } from '../pages/people/PeoplePage';
import { StudentPage } from '../pages/people/StudentPage';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { BranchesPage } from '../pages/settings/BranchesPage';
import { PortalInvoices } from '../pages/portal/PortalInvoices';
import { PortalMessages, PortalMore } from '../pages/portal/PortalMessages';
import { PortalTimetable } from '../pages/portal/PortalTimetable';
import { PricingPage } from '../pages/settings/PricingPage';
import { PrivacyPage } from '../pages/settings/PrivacyPage';
import { MessagesPage } from '../pages/messages/MessagesPage';
import { TermsPage } from '../pages/settings/TermsPage';
import { ThemePage } from '../pages/settings/ThemePage';
import { TimetablePage } from '../pages/timetable/TimetablePage';
import { SetupNeededPage } from '../pages/SetupNeededPage';
import { SignInPage } from '../pages/SignInPage';
import { SignUpPage } from '../pages/SignUpPage';
import { TeamPage } from '../pages/TeamPage';
import { WelcomePage } from '../pages/WelcomePage';
import { AuthProvider } from './AuthProvider';
import { HomeRedirect, RedirectIfSignedIn, RequireSignedIn } from './guards';
import { OrgLayout } from './OrgLayout';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx won't change by asking again; a network blip or 5xx might.
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500 && error.status > 0) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const publishableKey: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function Root() {
  if (!publishableKey) return <SetupNeededPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider publishableKey={publishableKey}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Routes. Signed out: sign-in, sign-up and invitation links. Signed in: the landing redirect,
 * welcome, onboarding, the org picker, and each org under `/o/:orgSlug` (its slug, from
 * `GET /me`).
 */
/**
 * A path the parent portal shares with staff (TUI-126): the parent's own page for a parent, the
 * staff page for everyone else, or not found where staff have none yet.
 */
function ForParent({ portal, staff }: { portal: ReactNode; staff?: ReactNode }) {
  const { membership } = useOrg();
  return <>{membership.role === 'parent' ? portal : (staff ?? <NotFoundPage />)}</>;
}

export const routes = [
  {
    element: <Root />,
    children: [
      {
        path: 'sign-in/*',
        element: (
          <RedirectIfSignedIn>
            <SignInPage />
          </RedirectIfSignedIn>
        ),
      },
      {
        path: 'sign-up/*',
        element: (
          <RedirectIfSignedIn>
            <SignUpPage />
          </RedirectIfSignedIn>
        ),
      },
      { path: 'invitations/:token', element: <InvitationPage /> },
      {
        element: <RequireSignedIn />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: 'welcome', element: <WelcomePage /> },
          { path: 'onboarding', element: <OnboardingPage /> },
          { path: 'orgs', element: <ChooseOrgPage /> },
          {
            path: 'o/:orgSlug',
            element: <OrgLayout />,
            children: [
              { index: true, element: <HomePage /> },
              {
                path: 'timetable',
                element: <ForParent portal={<PortalTimetable />} staff={<TimetablePage />} />,
              },
              { path: 'classes', element: <ClassesPage /> },
              { path: 'classes/:classId', element: <ClassPage /> },
              { path: 'lessons/:sessionId', element: <LessonPage /> },
              { path: 'families', element: <PeoplePage /> },
              { path: 'families/:familyId', element: <FamilyPage /> },
              { path: 'students/:studentId', element: <StudentPage /> },
              {
                path: 'invoices',
                element: <ForParent portal={<PortalInvoices />} staff={<InvoicesPage />} />,
              },
              {
                path: 'messages',
                element: <ForParent portal={<PortalMessages />} staff={<MessagesPage />} />,
              },
              { path: 'more', element: <ForParent portal={<PortalMore />} /> },
              { path: 'invoices/:invoiceId', element: <InvoicePage /> },
              { path: 'payments', element: <PaymentsPage /> },
              { path: 'settings/branches', element: <BranchesPage /> },
              { path: 'settings/terms', element: <TermsPage /> },
              { path: 'settings/courses', element: <CoursesPage /> },
              { path: 'settings/team', element: <TeamPage /> },
              { path: 'settings/pricing', element: <PricingPage /> },
              { path: 'settings/theme', element: <ThemePage /> },
              { path: 'settings/privacy', element: <PrivacyPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
