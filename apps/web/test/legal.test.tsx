import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LegalPage } from '../src/pages/legal/LegalPage';
import { SignUpPage } from '../src/pages/SignUpPage';
import { signOutClerk } from './clerk';
import { renderRoutes } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const routes = [
  { path: '/terms', element: <LegalPage slug="terms" /> },
  { path: '/privacy', element: <LegalPage slug="privacy" /> },
  { path: '/dpa', element: <LegalPage slug="dpa" /> },
  { path: '/sign-up/*', element: <SignUpPage /> },
];

beforeEach(() => signOutClerk());

describe('the legal documents (TUI-85)', () => {
  it('shows a document with its summary and numbered sections, without signing in', async () => {
    renderRoutes(routes, '/terms');
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeTruthy();
    expect(screen.getByText('Last updated 31 October 2026')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'In plain English' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '12. Limitation of liability' })).toBeTruthy();
    expect(document.title).toBe('Terms of service · EduStrux');
  });

  it('links each section from the list of contents, and the other documents from the foot', async () => {
    renderRoutes(routes, '/privacy');
    const contents = screen.getAllByRole('navigation', { name: 'On this page' })[0]!;
    const link = within(contents).getByRole('link', { name: /Who we share it with/ });
    expect(link.getAttribute('href')).toBe('#share');
    expect(document.getElementById('share')).toBeTruthy();

    const footer = screen.getByRole('navigation', { name: 'Legal documents' });
    await userEvent.click(within(footer).getByRole('link', { name: 'Data processing agreement' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Data processing agreement' }),
    ).toBeTruthy();
  });

  it('asks people signing up to agree to the terms and privacy policy, linked', () => {
    renderRoutes(routes, '/sign-up');
    expect(screen.getByText(/By signing up, you agree to the/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Terms of service' })[0]!.getAttribute('href')).toBe(
      '/terms',
    );
    expect(screen.getAllByRole('link', { name: 'Privacy policy' })[0]!.getAttribute('href')).toBe(
      '/privacy',
    );
  });
});
