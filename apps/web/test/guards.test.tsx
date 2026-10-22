import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeRedirect, RequireSignedIn } from '../src/app/guards';
import { signInAs, signOutClerk } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const routes = [
  {
    element: <RequireSignedIn />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'o/:orgSlug/*', element: <Where /> },
      { path: 'welcome', element: <Where /> },
      { path: 'orgs', element: <Where /> },
    ],
  },
  { path: 'sign-in', element: <Where /> },
];
const me = (slugs: string[]) => ({
  id: 'usr_1',
  email: 'a@example.com',
  name: 'A',
  memberships: slugs.map((slug) => ({
    id: `mem_${slug}`,
    role: 'owner',
    branchIds: null,
    org: { id: `org_${slug}`, name: slug, slug },
  })),
});

beforeEach(() => signOutClerk());

describe('signed-in pages', () => {
  it('send a signed-out user to sign in, and back to the page after', async () => {
    renderRoutes(routes, '/o/bright-minds/settings/team');
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/sign-in?redirect_url=%2Fo%2Fbright-minds%2Fsettings%2Fteam',
    );
  });

  it('land a new user with no org on the welcome page', async () => {
    signInAs();
    stubApi({ 'GET /api/v1/me': { body: me([]) } });
    renderRoutes(routes, '/');
    expect(await screen.findByTestId('where')).toHaveTextContent('/welcome');
  });

  it('open the only org, or the picker for several', async () => {
    signInAs();
    stubApi({ 'GET /api/v1/me': { body: me(['bright-minds']) } });
    const one = renderRoutes(routes, '/');
    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
    one.unmount();

    stubApi({ 'GET /api/v1/me': { body: me(['a', 'b']) } });
    renderRoutes(routes, '/');
    expect(await screen.findByTestId('where')).toHaveTextContent('/orgs');
  });
});
