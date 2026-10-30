import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../src/pages/OnboardingPage';
import { signInAs } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The first two steps of the setup wizard (TUI-130): the centre's details, then solo or a team,
// whose Continue makes the org and opens the rest of the wizard inside it.

const routes = [
  { path: '/onboarding', element: <OnboardingPage /> },
  { path: '*', element: <Where /> },
];

beforeEach(() => signInAs());

async function detailsThenType(name: string, country: string) {
  await userEvent.type(screen.getByLabelText(/Centre name/), name);
  await userEvent.selectOptions(screen.getByLabelText('Country'), country);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('heading', { name: 'How do you run your centre?' })).toBeVisible();
}

describe('setting up a centre', () => {
  it('suggests the web address, creates the org and opens the wizard at tax', async () => {
    const calls = stubApi({
      'POST /api/v1/orgs': { status: 201, body: { id: 'org_1', slug: 'bright-minds' } },
    });
    renderRoutes(routes, '/onboarding');
    expect(screen.getByText('Step 1 of 8', { selector: 'p' })).toBeVisible();

    await userEvent.type(screen.getByLabelText(/Centre name/), 'Bright Minds');
    expect(screen.getByLabelText('Web address')).toHaveValue('bright-minds');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'NZ');
    expect(screen.getByText('NZD')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await userEvent.click(await screen.findByLabelText(/Just me/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds/setup?step=tax');
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Bright Minds',
      slug: 'bright-minds',
      country: 'NZ',
      currency: 'NZD',
      locale: 'en-NZ',
      dateFormat: 'DD/MM/YYYY',
      singleTutorMode: true,
    });
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('switches to US dates and dollars for the United States, as a team by default', async () => {
    const calls = stubApi({
      'POST /api/v1/orgs': { status: 201, body: { id: 'org_1', slug: 'x' } },
    });
    renderRoutes(routes, '/onboarding');
    await detailsThenType('Ace Tutors', 'US');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('where');
    expect(calls[0]!.body).toMatchObject({
      currency: 'USD',
      locale: 'en-US',
      dateFormat: 'MM/DD/YYYY',
      singleTutorMode: false,
    });
  });

  it('needs a name before the second step', async () => {
    stubApi({});
    renderRoutes(routes, '/onboarding');
    await userEvent.type(screen.getByLabelText(/Centre name/), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Give your centre a name of at least 2 characters.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'How do you run your centre?' })).toBeNull();
  });

  it('goes back to the first step for a web address that’s taken', async () => {
    stubApi({
      'POST /api/v1/orgs': {
        status: 409,
        body: {
          error: { code: 'conflict', message: 'That slug is taken', fields: { slug: ['Taken'] } },
        },
      },
    });
    renderRoutes(routes, '/onboarding');
    await detailsThenType('Bright Minds', 'NZ');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Taken')).toBeVisible();
    expect(screen.getByLabelText('Web address')).toHaveAttribute('aria-invalid', 'true');
  });
});
