import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../src/pages/OnboardingPage';
import { signInAs } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const routes = [
  { path: '/onboarding', element: <OnboardingPage /> },
  { path: '*', element: <Where /> },
];

beforeEach(() => signInAs());

describe('setting up a centre', () => {
  it('creates the org with the browser’s defaults and opens it', async () => {
    const calls = stubApi({
      'POST /api/v1/orgs': { status: 201, body: { id: 'org_1', slug: 'bright-minds' } },
    });
    renderRoutes(routes, '/onboarding');

    await userEvent.type(screen.getByLabelText(/Centre name/), 'Bright Minds');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'NZ');
    await userEvent.click(screen.getByLabelText(/Just me/));
    await userEvent.click(screen.getByRole('button', { name: 'Create centre' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Bright Minds',
      country: 'NZ',
      currency: 'NZD',
      locale: 'en-NZ',
      dateFormat: 'DD/MM/YYYY',
      singleTutorMode: true,
    });
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('switches to US dates and dollars for the United States', async () => {
    const calls = stubApi({
      'POST /api/v1/orgs': { status: 201, body: { id: 'org_1', slug: 'x' } },
    });
    renderRoutes(routes, '/onboarding');
    await userEvent.type(screen.getByLabelText(/Centre name/), 'Ace Tutors');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'US');
    await userEvent.click(screen.getByRole('button', { name: 'Create centre' }));
    await screen.findByTestId('where');
    expect(calls[0]!.body).toMatchObject({
      currency: 'USD',
      locale: 'en-US',
      dateFormat: 'MM/DD/YYYY',
      singleTutorMode: false,
    });
  });

  it('shows the API’s field errors under the fields', async () => {
    stubApi({
      'POST /api/v1/orgs': {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'x',
            fields: { name: ['Too small: expected string to have >=2 characters'] },
          },
        },
      },
    });
    renderRoutes(routes, '/onboarding');
    await userEvent.type(screen.getByLabelText(/Centre name/), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Create centre' }));
    expect(await screen.findByText(/expected string to have >=2 characters/)).toBeVisible();
    expect(screen.getByLabelText(/Centre name/)).toHaveAttribute('aria-invalid', 'true');
  });
});
