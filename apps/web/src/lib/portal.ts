import type {
  Holiday,
  PortalChild,
  PortalInvoice,
  PortalMessage,
  PortalSession,
  SessionNotes,
} from '@edustrux/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { invoiceStatus } from './billing';
import { orgApiPath, useOrg } from './org';
import { query, type Page } from './people';
import { orgPath } from './session';

// The parent portal's reads (TUI-126): each is the parent's own family, through the portal
// routes, so nothing a parent can't see is asked for (D-126).

/** The parent's children, with their active enrolments. The whole list, in name order. */
export function usePortalChildren() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['portal', membership.org.id, 'children'],
    queryFn: ({ signal }) =>
      api<{ data: PortalChild[] }>('GET', orgApiPath(membership, '/portal/children'), {
        signal,
      }),
    staleTime: 60_000,
  });
}

/** The children's lessons from one date to another, both included, oldest first. */
export function usePortalSessions(
  { from, to, studentId }: { from: string; to: string; studentId?: string },
  enabled = true,
) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['portal', membership.org.id, 'sessions', { from, to, studentId }],
    queryFn: ({ signal }) =>
      api<Page<PortalSession>>(
        'GET',
        orgApiPath(
          membership,
          `/portal/sessions${query({ from, to, studentId: studentId ?? '', limit: 200 })}`,
        ),
        { signal },
      ),
    enabled,
  });
}

/** The family's issued invoices, newest first (drafts never reach a parent, D-096). */
export function usePortalInvoices() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['portal', membership.org.id, 'invoices'],
    queryFn: ({ signal }) =>
      api<Page<PortalInvoice>>('GET', orgApiPath(membership, '/portal/invoices?limit=200'), {
        signal,
      }),
  });
}

/** Announcements and automatic messages sent to the family, newest first. */
export function usePortalMessages() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['portal', membership.org.id, 'messages'],
    queryFn: ({ signal }) =>
      api<Page<PortalMessage>>('GET', orgApiPath(membership, '/portal/messages?limit=200'), {
        signal,
      }),
  });
}

/** The centre's holidays: the ones for every branch and for the children's home branches. */
export function usePortalHolidays(branchIds: string[]) {
  const { membership } = useOrg();
  const holidays = useQuery({
    queryKey: ['holidays', membership.org.id],
    queryFn: ({ signal }) =>
      api<Page<Holiday>>('GET', orgApiPath(membership, '/holidays?limit=200'), { signal }),
    staleTime: 60_000,
  });
  return (holidays.data?.data ?? []).filter(
    (h) => h.branchId === null || branchIds.includes(h.branchId),
  );
}

/** The homework and the teacher's notes for each lesson, read one lesson at a time. */
export function useLessonNotes(sessionIds: string[]) {
  const { membership } = useOrg();
  return useQueries({
    queries: sessionIds.map((id) => ({
      queryKey: ['attendance', membership.org.id, id, 'notes'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<SessionNotes>('GET', orgApiPath(membership, `/sessions/${id}/notes`), { signal }),
      staleTime: 60_000,
    })),
  });
}

/** What the family owes across its open invoices, and how much of it is past due. */
export function familyBalance(invoices: PortalInvoice[], today: string) {
  let owing = 0;
  let overdue = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'void' || invoice.balance.amount <= 0) continue;
    owing += invoice.balance.amount;
    if (invoiceStatus(invoice, today) === 'overdue') overdue += invoice.balance.amount;
  }
  return { owing, overdue };
}

/** Where the portal's pages live in this org. */
export function usePortalPaths() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return {
    home: base,
    timetable: `${base}/timetable`,
    invoices: `${base}/invoices`,
    messages: `${base}/messages`,
    more: `${base}/more`,
    profile: `${base}/profile`,
  };
}
