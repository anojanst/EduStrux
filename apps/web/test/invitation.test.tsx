import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationPage } from '../src/pages/InvitationPage';
import { clerk, signInAs, signOutClerk } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const routes = [
  { path: '/invitations/:token', element: <InvitationPage /> },
  { path: '/o/:orgSlug', element: <Where /> },
  { path: '*', element: <Where /> },
];
const preview = (overrides: Record<string, unknown> = {}) => ({
  org: { name: 'Bright Minds Tuition', slug: 'bright-minds' },
  role: 'teacher',
  email: 'teach@example.com',
  status: 'pending',
  expiresAt: '2026-10-29T00:00:00.000Z',
  ...overrides,
});
const PREVIEW = 'GET /api/v1/invitations/tok123';
const ACCEPT = 'POST /api/v1/invitations/tok123/accept';
const joined = {
  id: 'mem_1',
  role: 'teacher',
  branchIds: null,
  org: { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' },
};

const props = (testId: string) =>
  JSON.parse(screen.getByTestId(testId).dataset.props ?? '{}') as Record<string, unknown>;

beforeEach(() => signOutClerk());

describe('an invitation link, signed out', () => {
  it('shows who invited them and as what, and signs them up with the invited address', async () => {
    const calls = stubApi({ [PREVIEW]: { body: preview() } });
    renderRoutes(routes, '/invitations/tok123');

    expect(await screen.findByRole('heading', { name: 'Join Bright Minds Tuition' })).toBeVisible();
    expect(screen.getByText('Teacher')).toBeVisible();
    expect(screen.getByText('Sent to teach@example.com')).toBeVisible();
    expect(props('clerk-sign-up')).toMatchObject({
      routing: 'hash',
      initialValues: { emailAddress: 'teach@example.com' },
      forceRedirectUrl: '/invitations/tok123',
    });
    // The preview is read without a token: the person isn't signed in yet.
    expect(calls[0]!.headers.Authorization).toBeUndefined();

    await userEvent.click(screen.getByRole('tab', { name: 'I have an account' }));
    expect(props('clerk-sign-in')).toMatchObject({
      initialValues: { emailAddress: 'teach@example.com' },
      forceRedirectUrl: '/invitations/tok123',
    });
  });

  it('tells a parent what their account is for', async () => {
    stubApi({ [PREVIEW]: { body: preview({ role: 'parent', email: 'mere@example.com' }) } });
    renderRoutes(routes, '/invitations/tok123');
    expect(
      await screen.findByText(/see your family’s timetable, invoices and messages/),
    ).toBeVisible();
    expect(screen.getByText('Parent')).toBeVisible();
  });

  it('explains an unknown, expired or used link instead of a form', async () => {
    stubApi({
      [PREVIEW]: { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    });
    const first = renderRoutes(routes, '/invitations/tok123');
    expect(await screen.findByText('This invitation link doesn’t work')).toBeVisible();
    expect(screen.queryByTestId('clerk-sign-up')).toBeNull();
    first.unmount();

    stubApi({ [PREVIEW]: { body: preview({ status: 'expired' }) } });
    const second = renderRoutes(routes, '/invitations/tok123');
    expect(await screen.findByText('This invitation has expired')).toBeVisible();
    expect(
      screen.getByText('Invitations last 7 days. Ask Bright Minds Tuition to send you a new one.'),
    ).toBeVisible();
    second.unmount();

    stubApi({ [PREVIEW]: { body: preview({ status: 'accepted' }) } });
    renderRoutes(routes, '/invitations/tok123');
    expect(await screen.findByText('This invitation has been used')).toBeVisible();
  });
});

describe('an invitation link, signed in', () => {
  it('joins the org with one click and opens it', async () => {
    signInAs('teach@example.com');
    const calls = stubApi({ [PREVIEW]: { body: preview() }, [ACCEPT]: { body: joined } });
    renderRoutes(routes, '/invitations/tok123');

    expect(await screen.findByText('You’re signed in as teach@example.com.')).toBeVisible();
    expect(screen.queryByText('This invitation was sent to another address')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Join Bright Minds Tuition' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
    const accept = calls.find((c) => c.key === ACCEPT)!;
    expect(accept.headers.Authorization).toBe('Bearer test-token');
    expect(localStorage.getItem('edustrux.lastOrg')).toBe('bright-minds');
  });

  it('points out a different signed-in address, and lets them switch account', async () => {
    signInAs('someone.else@example.com');
    stubApi({ [PREVIEW]: { body: preview() } });
    renderRoutes(routes, '/invitations/tok123');

    expect(await screen.findByText('This invitation was sent to another address')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: '/invitations/tok123' });
  });

  it('says so when they are already a member, with a way into the org', async () => {
    signInAs('teach@example.com');
    stubApi({
      [PREVIEW]: { body: preview() },
      [ACCEPT]: { status: 409, body: { error: { code: 'conflict', message: 'x' } } },
    });
    renderRoutes(routes, '/invitations/tok123');
    await userEvent.click(await screen.findByRole('button', { name: 'Join Bright Minds Tuition' }));

    expect(
      await screen.findByText('You’re already a member of Bright Minds Tuition.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Bright Minds Tuition' })).toHaveAttribute(
      'href',
      '/o/bright-minds',
    );
  });

  it('explains an invite that was used between opening and accepting it', async () => {
    signInAs('teach@example.com');
    stubApi({
      [PREVIEW]: { body: preview() },
      [ACCEPT]: {
        status: 422,
        body: { error: { code: 'unprocessable', message: 'x', fields: { token: ['Used'] } } },
      },
    });
    renderRoutes(routes, '/invitations/tok123');
    await userEvent.click(await screen.findByRole('button', { name: 'Join Bright Minds Tuition' }));
    expect(
      await screen.findByText(/This invitation to Bright Minds Tuition has already been accepted/),
    ).toBeVisible();
  });
});
