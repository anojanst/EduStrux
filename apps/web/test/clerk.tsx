import type { ReactNode } from 'react';
import { vi } from 'vitest';

type Email = {
  id: string;
  emailAddress: string;
  verification: { status: 'verified' | 'unverified' };
  prepareVerification: ReturnType<typeof vi.fn>;
  attemptVerification: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

export function makeEmail(id: string, address: string, verified = true): Email {
  const email: Email = {
    id,
    emailAddress: address,
    verification: { status: verified ? 'verified' : 'unverified' },
    prepareVerification: vi.fn(async () => email),
    attemptVerification: vi.fn(async () => {
      email.verification.status = 'verified';
      return email;
    }),
    destroy: vi.fn(async () => {
      clerk.emails = clerk.emails.filter((e) => e.id !== id);
    }),
  };
  return email;
}

export function makeSession(
  id: string,
  activity: Record<string, unknown>,
  lastActiveAt = new Date(),
) {
  return {
    id,
    status: 'active',
    lastActiveAt,
    latestActivity: activity,
    revoke: vi.fn(async () => ({})),
  };
}

/**
 * A stand-in for `@clerk/react`: tests set who is signed in and what their account holds, and
 * Clerk's sign-in and sign-up components render as placeholders that show the props the app gave
 * them. `requireReverify` makes the next sensitive change ask "Confirm it's you" first.
 */
export const clerk = {
  signedIn: false,
  email: 'person@example.com' as string | null,
  firstName: 'Olivia' as string | null,
  lastName: null as string | null,
  emails: [] as Email[],
  primaryEmailId: null as string | null,
  hasImage: false,
  deleteSelfEnabled: true,
  sessions: [] as ReturnType<typeof makeSession>[],
  requireReverify: false,
  signOut: vi.fn(async (_?: unknown) => {}),
  updateUser: vi.fn(async (_: Record<string, unknown>) => ({})),
  getToken: vi.fn(async (_?: { skipCache?: boolean }) => (clerk.signedIn ? 'test-token' : null)),
  setProfileImage: vi.fn(async (_: { file: unknown }) => ({})),
  deleteUser: vi.fn(async () => {}),
  createEmailAddress: vi.fn(async ({ email }: { email: string }) => {
    const created = makeEmail(`em_${clerk.emails.length + 1}`, email, false);
    clerk.emails.push(created);
    return created;
  }),
  session: {
    id: 'sess_current',
    startVerification: vi.fn(async (_: unknown) => ({
      supportedFirstFactors: [
        { strategy: 'email_code', emailAddressId: 'em_1', safeIdentifier: 'e***@example.com' },
      ],
    })),
    prepareFirstFactorVerification: vi.fn(async (_: unknown) => ({})),
    attemptFirstFactorVerification: vi.fn(async (_: unknown) => ({ status: 'complete' })),
  },
};

export function signInAs(email: string | null = 'person@example.com') {
  clerk.signedIn = true;
  clerk.email = email;
}

export function signOutClerk() {
  clerk.signedIn = false;
}

/** A signed-in account with one verified email, no photo or other devices. */
export function resetAccount(email = 'ethan@example.com') {
  signInAs(email);
  clerk.firstName = null;
  clerk.lastName = null;
  clerk.emails = [makeEmail('em_1', email)];
  clerk.primaryEmailId = 'em_1';
  clerk.hasImage = false;
  clerk.deleteSelfEnabled = true;
  clerk.sessions = [
    makeSession('sess_current', {
      browserName: 'Chrome',
      deviceType: 'Windows',
      city: 'Auckland',
      country: 'NZ',
    }),
  ];
  clerk.requireReverify = false;
  for (const fn of [
    clerk.signOut,
    clerk.updateUser,
    clerk.getToken,
    clerk.setProfileImage,
    clerk.deleteUser,
    clerk.createEmailAddress,
    clerk.session.startVerification,
    clerk.session.prepareFirstFactorVerification,
    clerk.session.attemptFirstFactorVerification,
  ]) {
    fn.mockClear();
  }
}

const Placeholder =
  (name: string) =>
  (props: Record<string, unknown>): ReactNode => (
    <div data-testid={name} data-props={JSON.stringify(props)} />
  );

function currentUser() {
  const primary = clerk.emails.find((e) => e.id === clerk.primaryEmailId);
  return {
    id: 'user_1',
    firstName: clerk.firstName,
    lastName: clerk.lastName,
    hasImage: clerk.hasImage,
    imageUrl: 'https://img.example/me.png',
    deleteSelfEnabled: clerk.deleteSelfEnabled,
    emailAddresses: clerk.emails,
    primaryEmailAddressId: clerk.primaryEmailId,
    primaryEmailAddress: primary ?? (clerk.email ? { emailAddress: clerk.email } : null),
    update: clerk.updateUser,
    setProfileImage: clerk.setProfileImage,
    createEmailAddress: clerk.createEmailAddress,
    getSessions: async () => clerk.sessions,
    delete: clerk.deleteUser,
  };
}

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
  useUser: () => ({ isLoaded: true, user: clerk.signedIn ? currentUser() : null }),
  useSession: () => ({ session: clerk.signedIn ? clerk.session : null }),
  useClerk: () => ({ signOut: clerk.signOut }),
  /** As Clerk's: runs the change, first asking for proof when `requireReverify` is set. */
  useReverification:
    <Args extends unknown[], R>(
      fn: (...args: Args) => Promise<R>,
      options?: {
        onNeedsReverification?: (p: {
          complete: () => void;
          cancel: () => void;
          level: 'first_factor';
        }) => void;
      },
    ) =>
    async (...args: Args) => {
      if (clerk.requireReverify) {
        clerk.requireReverify = false;
        await new Promise<void>((resolve, reject) =>
          options?.onNeedsReverification?.({
            complete: resolve,
            cancel: () => reject(new Error('cancelled')),
            level: 'first_factor',
          }),
        );
      }
      return fn(...args);
    },
};
