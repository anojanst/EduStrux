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
  signOut: vi.fn(async () => {}),
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
    getToken: async () => (clerk.signedIn ? 'test-token' : null),
  }),
  useUser: () => ({
    isLoaded: true,
    user: clerk.signedIn
      ? {
          firstName: clerk.firstName,
          primaryEmailAddress: clerk.email ? { emailAddress: clerk.email } : null,
        }
      : null,
  }),
  useClerk: () => ({ signOut: clerk.signOut }),
};
