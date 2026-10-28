import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { MessagesPage } from '../src/pages/messages/MessagesPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Messages (TUI-128): staff send announcements and follow their delivery; the owner keeps the
// templates and sets the automatic messages.

const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner') =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Hart',
          memberships: [{ id: 'mem_me', role, branchIds: null, org: ref }],
        },
        membership: { id: 'mem_me', role, branchIds: null, org: ref },
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const ORG = '/api/v1/orgs/org_1';
const at = '2026-10-20T03:40:00.000Z';
const routes = [{ path: '/o/:orgSlug/messages', element: <MessagesPage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });

const message = (id: string, extra: object = {}) => ({
  id,
  kind: 'announcement',
  event: null,
  subject: 'Term 4 starts next week',
  body: 'Classes resume on Tuesday.',
  audience: { type: 'grade', ids: ['g9'] },
  channels: ['email', 'portal'],
  templateId: null,
  sentByMembershipId: 'mem_me',
  recipientCount: 42,
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const announcement = message('msg_1');
const automatic = message('msg_2', {
  kind: 'automatic',
  event: 'invoice_issued',
  subject: 'October invoice issued',
  audience: { type: 'custom', ids: ['fam_1', 'fam_2', 'fam_3'] },
  channels: ['email'],
  sentByMembershipId: null,
  recipientCount: 3,
});
const settings = {
  sessionChanges: true,
  invoiceIssued: true,
  overdueReminders: true,
  overdueReminderDays: [1, 7],
  reminderHour: 9,
  replyToEmail: null,
  updatedAt: null,
};
const lookups = {
  [`${API}/messages?limit=25`]: page([announcement, automatic]),
  [`${API}/messages?limit=25&kind=automatic`]: page([automatic]),
  [`${API}/branches?limit=200`]: page([{ id: 'brn_a', name: 'Albany' }]),
  [`${API}/grade-levels`]: page([
    { id: 'g9', name: 'Year 9' },
    { id: 'g10', name: 'Year 10' },
  ]),
  [`${API}/subjects?limit=200`]: page([{ id: 'sub_m', name: 'Maths' }]),
  [`${API}/classes?limit=200`]: page([{ id: 'cls_1', name: 'Year 9 Maths' }]),
  [`${API}/teachers`]: page([{ id: 'mem_t', name: 'Ms Perera' }]),
  [`${API}/staff?limit=200`]: page([{ id: 'mem_me', name: 'Olivia Hart' }]),
  [`${API}/message-templates?limit=200`]: page([
    {
      id: 'mtp_1',
      name: 'Term starts',
      subject: 'Term starts soon',
      body: 'See you on Tuesday.',
      createdAt: at,
      updatedAt: at,
    },
  ]),
  [`${API}/notification-settings`]: { body: settings },
};

describe('the sent messages', () => {
  it('lists what was sent, to whom, how many and by whom', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('owner'));

    const first = (await screen.findByText('Term 4 starts next week')).closest('button')!;
    expect(await within(first).findByText('Year 9')).toBeVisible();
    expect(within(first).getAllByText('42 guardians')[0]).toBeInTheDocument();
    expect(within(first).getByText('Olivia Hart')).toBeVisible();
    const second = screen.getByText('October invoice issued').closest('button')!;
    expect(within(second).getByText('Invoice issued')).toBeVisible();
    expect(within(second).getByText('3 families')).toBeVisible();
    expect(within(second).getByText('System')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Automatic', pressed: false }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === `${API}/messages?limit=25&kind=automatic`)).toBe(true),
    );
  });

  it("opens a message with each recipient's email status", async () => {
    stubApi({
      ...lookups,
      [`${API}/messages/msg_1`]: {
        body: {
          ...announcement,
          delivery: {
            queued: 0,
            sent: 1,
            delivered: 1,
            bounced: 1,
            complained: 0,
            failed: 0,
            skipped: 0,
          },
          recipients: [
            {
              id: 'r1',
              familyId: 'fam_1',
              guardianId: 'g1',
              email: 'mere@example.com',
              emailStatus: 'delivered',
              error: null,
              sentAt: at,
              deliveredAt: at,
            },
            {
              id: 'r2',
              familyId: 'fam_2',
              guardianId: 'g2',
              email: 'old@example.com',
              emailStatus: 'bounced',
              error: 'Mailbox does not exist',
              sentAt: at,
              deliveredAt: null,
            },
          ],
        },
      },
      [`${API}/families?limit=200`]: page([
        { id: 'fam_1', name: 'Perera' },
        { id: 'fam_2', name: 'Chen' },
      ]),
    });
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('owner'));
    await userEvent.click(await screen.findByText('Term 4 starts next week'));

    const dialog = await screen.findByRole('dialog', { name: 'Term 4 starts next week' });
    expect(within(dialog).getByText(/^Sent .+ by Olivia Hart · Email and portal$/)).toBeVisible();
    expect(await within(dialog).findByText('mere@example.com')).toBeVisible();
    expect(within(dialog).getByText('Mailbox does not exist')).toBeVisible();
    expect(within(dialog).getAllByText('Chen family')[0]).toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByLabelText('Email status'), 'bounced');
    expect(within(dialog).queryByText('mere@example.com')).toBeNull();
  });

  it('is not for parents or accountants', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('accountant'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('sending an announcement', () => {
  it('sends to a grade after a confirm step', async () => {
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/messages`]: { status: 201, body: { ...announcement, recipientCount: 12 } },
    });
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));

    const dialog = await screen.findByRole('dialog', { name: 'New announcement' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Start from a template/), 'mtp_1');
    expect(within(dialog).getByLabelText(/^Subject \(/)).toHaveValue('Term starts soon');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Grade' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send announcement' }));
    expect(within(dialog).getByText('Choose who it goes to.')).toBeVisible();

    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Add grade' }),
      'g9',
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Email' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send announcement' }));

    const confirm = await screen.findByRole('dialog', { name: 'Send announcement?' });
    expect(within(confirm).getByText('Send to Year 9 by the portal?')).toBeVisible();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Send announcement' }));
    expect(await screen.findByText('Announcement sent to 12 guardians')).toBeVisible();
    expect(calls.find((c) => c.key === `POST ${ORG}/messages`)?.body).toEqual({
      subject: 'Term starts soon',
      body: 'See you on Tuesday.',
      templateId: 'mtp_1',
      audience: { type: 'grade', ids: ['g9'] },
      channels: ['portal'],
    });
  });

  it('says when nobody the sender reaches is in the audience', async () => {
    stubApi({
      ...lookups,
      [`POST ${ORG}/messages`]: {
        status: 422,
        body: {
          error: {
            code: 'unprocessable',
            message: 'Nobody you can reach is in this audience.',
            fields: { audience: ['No one'] },
          },
        },
      },
    });
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    const dialog = await screen.findByRole('dialog', { name: 'New announcement' });
    await userEvent.type(within(dialog).getByLabelText(/^Subject \(/), 'Closed Friday');
    await userEvent.type(within(dialog).getByLabelText(/^Message/), 'No lessons on Friday.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send announcement' }));
    const confirm = await screen.findByRole('dialog', { name: 'Send announcement?' });
    expect(
      within(confirm).getByText('Send to all families by email and the portal?'),
    ).toBeVisible();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Send announcement' }));

    expect(await screen.findByText('Nobody you can reach is in this audience.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'New announcement' })).toBeVisible();
  });

  it('lets a teacher write to their own classes only', async () => {
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/messages`]: { status: 201, body: { ...announcement, recipientCount: 9 } },
    });
    renderRoutes(routes, '/o/bright-minds/messages', inOrg('teacher'));
    expect(screen.queryByRole('tab', { name: 'Templates' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));

    const dialog = await screen.findByRole('dialog', { name: 'New announcement' });
    const choices = within(dialog)
      .getAllByRole('radio')
      .map((r) => r.closest('label')!.textContent);
    expect(choices).toEqual(['My classes', 'Class']);
    await userEvent.type(within(dialog).getByLabelText(/^Subject \(/), 'Test next week');
    await userEvent.type(within(dialog).getByLabelText(/^Message/), 'Revise chapter 4.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send announcement' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Send announcement?' })).getByRole(
        'button',
        { name: 'Send announcement' },
      ),
    );
    await screen.findByText('Announcement sent to 9 guardians');
    expect(calls.find((c) => c.key === `POST ${ORG}/messages`)?.body).toMatchObject({
      audience: { type: 'teacher', ids: ['mem_me'] },
    });
  });
});

describe('the automatic messages', () => {
  it('saves which go out and when reminders are sent', async () => {
    const calls = stubApi({
      ...lookups,
      [`PUT ${ORG}/notification-settings`]: ({ body }) => ({ body }),
    });
    renderRoutes(routes, '/o/bright-minds/messages?tab=automatic', inOrg('owner'));

    await userEvent.click(
      await screen.findByRole('switch', { name: 'Email an invoice when it’s issued' }),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add day' }), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 day' }));
    await userEvent.type(screen.getByLabelText('Reply-to email'), 'office@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Automatic messages saved')).toBeVisible();
    expect(calls.find((c) => c.key === `PUT ${ORG}/notification-settings`)?.body).toEqual({
      sessionChanges: true,
      invoiceIssued: false,
      overdueReminders: true,
      overdueReminderDays: [7, 14],
      reminderHour: 9,
      replyToEmail: 'office@example.com',
    });
  });
});
