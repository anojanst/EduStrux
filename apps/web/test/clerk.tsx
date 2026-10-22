import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * A stand-in for `@clerk/react`: tests set who is signed in, and Clerk's sign-in and sign-up
 * components render as placeholders that show the props the app gave them.
 */
export const clerk = {
  signedIn: false,
  email: 'person@example.com' as string | null,
  firstName: 'Olivia' as string | null,
  lastName: null as string | null,
  signOut: vi.fn(async () => {}),
  updateUser: vi.fn(async (_: { firstName?: string; lastName?: string }) => ({})),
  getToken: vi.fn(async (_?: { skipCache?: boolean }) => (clerk.signedIn ? 'test-token' : null)),
};

export function signInAs(email: string | null = 'person@example.com') {
  clerk.signedIn = true;
  clerk.email = email;
}

export function signOutClerk() {
  clerk.signedIn = false;
}

const Placeholder =
  (name: string) =>
  (props: Record<string, unknown>): ReactNode => (
    <div data-testid={name} data-props={JSON.stringify(props)} />
  );

export const clerkModule = {
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  SignIn: Placeholder('clerk-sign-in'),
  SignUp: Placeholder('clerk-sign-up'),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: clerk.signedIn,
    userId: clerk.signedIn ? 'user_1' : null,
    getToken: clerk.getToken,
  }),
  useUser: () => ({
    isLoaded: true,
    user: clerk.signedIn
      ? {
          firstName: clerk.firstName,
          lastName: clerk.lastName,
          update: clerk.updateUser,
          primaryEmailAddress: clerk.email ? { emailAddress: clerk.email } : null,
        }
      : null,
  }),
  useClerk: () => ({ signOut: clerk.signOut }),
};
