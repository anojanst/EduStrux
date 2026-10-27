import type { Branch, Class, Family, Holiday, Room, StaffMember } from '@edustrux/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Info, MapPin, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { PageError, PageHeader, errorMessage } from '../../components/PageState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Field, TextField } from '../../components/ui/Field';
import { OverflowMenu } from '../../components/ui/Menu';
import { Notice } from '../../components/ui/Notice';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { useAllClasses, useClassPaths } from '../../lib/classes';
import { orgApiPath, useOrg } from '../../lib/org';
import { useBranches, usePeoplePaths, type Page } from '../../lib/people';
import { can } from '../../lib/roles';
import { orgPath } from '../../lib/session';
import { SkeletonRows } from '../people/parts';

/**
 * Settings › Branches & rooms (TUI-124): each branch and the rooms classes are held in. The owner
 * adds, edits and deletes them; other staff see them. Parents use the portal instead.
 */
export function BranchesPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'org:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Branches />;
}

type Open =
  | { kind: 'branch'; branch?: Branch }
  | { kind: 'room'; branch: Branch; room?: Room }
  | { kind: 'deleteBranch'; branch: Branch }
  | { kind: 'deleteRoom'; branch: Branch; room: Room }
  | null;

/** A branch's rooms (`GET /branches/{id}/rooms`), under the key the room pickers use. */
const roomsQuery = (orgId: string, path: string, branchId: string) => ({
  queryKey: ['rooms', orgId, branchId],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api<Page<Room>>('GET', `${path}/branches/${branchId}/rooms?limit=200`, { signal }),
  staleTime: 60_000,
});

/** After a change to a branch or room: the lists that show them. */
function useRefreshBranches() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  return () =>
    Promise.all(
      ['branches', 'rooms', 'classes'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, orgId] }),
      ),
    );
}

const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) =>
  t(n === 1 ? one : many, { n });

function Branches() {
  const { membership, org } = useOrg();
  const [open, setOpen] = useState<Open>(null);
  const owner = can(membership.role, 'org:write');
  const branches = useBranches();
  const classes = useAllClasses();
  const list = branches.data?.data ?? [];
  const roomLists = useQueries({
    queries: list.map((b) => roomsQuery(membership.org.id, orgApiPath(membership), b.id)),
  });
  const roomsOf = new Map(list.map((b, i) => [b.id, roomLists[i]]));
  const roomTotal = roomLists.reduce((sum, q) => sum + (q.data?.data.length ?? 0), 0);
  const allClasses = classes.data?.data ?? [];
  const singleTutor = org?.singleTutorMode === true;
  const close = () => setOpen(null);

  if (branches.isError) {
    return <PageError error={branches.error} onRetry={() => void branches.refetch()} />;
  }

  return (
    <div>
      <PageHeader
        overline={t('courses.overline')}
        title={t('branches.title')}
        subtitle={
          branches.isSuccess && roomLists.every((q) => q.isSuccess)
            ? `${count(list.length, 'branches.count.one', 'branches.count')} · ${count(roomTotal, 'branches.rooms.one', 'branches.rooms')}`
            : undefined
        }
        action={
          owner && !singleTutor ? (
            <Button
              className="w-full sm:w-auto"
              icon={<Plus className="size-4" />}
              onClick={() => setOpen({ kind: 'branch' })}
            >
              {t('branches.add')}
            </Button>
          ) : null
        }
      />
      {!owner ? (
        <Notice tone="info" className="mb-4">
          {t('branches.readOnly')}
        </Notice>
      ) : singleTutor ? (
        <p className="mb-4 flex items-center gap-2 text-body text-muted">
          <Info className="size-4 shrink-0" aria-hidden />
          {t('branches.singleTutor')}
        </p>
      ) : null}
      <p className="mb-5 max-w-[720px] text-body text-muted">{t('branches.explainer')}</p>

      {branches.isPending ? (
        <Card flush>
          <SkeletonRows rows={3} />
        </Card>
      ) : (
        list.map((branch) => {
          const rooms = roomsOf.get(branch.id);
          return (
            <BranchCard
              key={branch.id}
              branch={branch}
              rooms={rooms?.data?.data}
              roomsError={rooms?.isError ? rooms.error : null}
              classes={allClasses.filter((c) => c.branchId === branch.id)}
              owner={owner}
              onOpen={setOpen}
            />
          );
        })
      )}

      {open?.kind === 'branch' ? <BranchDialog branch={open.branch} onClose={close} /> : null}
      {open?.kind === 'room' ? (
        <RoomDialog branch={open.branch} room={open.room} onClose={close} />
      ) : null}
      {open?.kind === 'deleteBranch' ? (
        <DeleteBranch
          branch={open.branch}
          last={list.length <= 1}
          rooms={roomsOf.get(open.branch.id)?.data?.data.length ?? 0}
          classes={allClasses.filter((c) => c.branchId === open.branch.id).length}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteRoom' ? (
        <DeleteRoom
          branch={open.branch}
          room={open.room}
          classes={allClasses.filter((c) => c.roomId === open.room.id)}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/** A branch: its name and address, how much it holds, and its rooms. */
function BranchCard({
  branch,
  rooms,
  roomsError,
  classes,
  owner,
  onOpen,
}: {
  branch: Branch;
  rooms: Room[] | undefined;
  roomsError: unknown;
  classes: Class[];
  owner: boolean;
  onOpen: (open: Open) => void;
}) {
  const inRoom = (roomId: string) => classes.filter((c) => c.roomId === roomId).length;
  return (
    <Card flush className="mb-4">
      <div className="grid min-h-[82px] grid-cols-[42px_1fr_40px] items-start gap-x-3 border-b border-border px-3 py-3.5 sm:grid-cols-[42px_1fr_auto_40px] sm:items-center sm:px-4">
        <span className="row-span-2 grid size-10 place-items-center rounded-lg bg-brand-soft text-brand sm:row-span-1">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-section font-medium break-words text-text">{branch.name}</h2>
          <p className="mt-0.5 text-meta whitespace-pre-line text-muted">
            {branch.address ?? (
              <>
                {t('branches.noAddress')}
                {owner ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => onOpen({ kind: 'branch', branch })}
                      className="font-semibold text-brand hover:underline"
                    >
                      {t('branches.addAddress')}
                    </button>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        <span className="col-span-2 col-start-2 pt-2 text-meta text-muted tabular-nums sm:col-span-1 sm:col-start-3 sm:pt-0">
          {rooms
            ? `${count(rooms.length, 'branches.rooms.one', 'branches.rooms')} · ${count(classes.length, 'branches.classes.one', 'branches.classes')}`
            : null}
        </span>
        {owner ? (
          <div className="col-start-3 row-start-1 sm:col-start-4">
            <OverflowMenu
              label={t('branches.actions', { name: branch.name })}
              items={[
                { label: t('branches.edit'), onSelect: () => onOpen({ kind: 'branch', branch }) },
                {
                  label: t('branches.delete'),
                  danger: true,
                  onSelect: () => onOpen({ kind: 'deleteBranch', branch }),
                },
              ]}
            />
          </div>
        ) : null}
      </div>

      {roomsError ? (
        <p className="px-4 py-4 text-body text-danger">{errorMessage(roomsError)}</p>
      ) : !rooms ? (
        <SkeletonRows rows={2} />
      ) : rooms.length === 0 ? (
        <div className="m-4 flex min-h-[100px] items-center gap-3 rounded-lg bg-canvas p-[18px]">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-[#f0f4f4] text-muted">
            <DoorOpen className="size-4" aria-hidden />
          </span>
          <div>
            <b className="text-body font-semibold text-text">{t('branches.noRooms')}</b>
            <p className="mt-1 text-meta text-muted">{t('branches.noRoomsBody')}</p>
          </div>
        </div>
      ) : (
        <ul className="px-3 sm:px-4">
          {rooms.map((room) => {
            const seats =
              room.capacity === null
                ? t('branches.noLimit')
                : t('branches.seats', { n: room.capacity });
            const used = count(inRoom(room.id), 'branches.classes.one', 'branches.classes');
            return (
              <li
                key={room.id}
                className="grid min-h-14 grid-cols-[34px_1fr_40px] items-center gap-3 border-b border-border py-[7px] sm:min-h-[60px] sm:grid-cols-[36px_minmax(160px,1fr)_100px_40px] sm:py-0"
              >
                <span className="grid size-[34px] place-items-center rounded-lg bg-[#f0f4f4] text-muted">
                  <DoorOpen className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className="truncate text-body font-semibold text-text">{room.name}</b>
                  <small className="text-meta text-muted">
                    {seats}
                    <span className="sm:hidden"> · {used}</span>
                  </small>
                </span>
                <span className="hidden text-meta text-muted sm:block">{used}</span>
                {owner ? (
                  <OverflowMenu
                    label={t('branches.roomActions', { name: room.name })}
                    items={[
                      {
                        label: t('branches.room.edit'),
                        onSelect: () => onOpen({ kind: 'room', branch, room }),
                      },
                      {
                        label: t('branches.room.delete'),
                        danger: true,
                        onSelect: () => onOpen({ kind: 'deleteRoom', branch, room }),
                      },
                    ]}
                  />
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {owner ? (
        <div className="flex min-h-[54px] items-center px-3 py-[7px] sm:px-4">
          <Button
            variant="ghost"
            className="max-sm:h-11"
            icon={<Plus className="size-4" />}
            onClick={() => onOpen({ kind: 'room', branch })}
          >
            {t('branches.room.add')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Add a branch, or change its name and address. Names are unique in the org, ignoring case. */
function BranchDialog({ branch, onClose }: { branch?: Branch; onClose: () => void }) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshBranches();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [missing, setMissing] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), address: address.trim() || null };
      return branch
        ? api('PATCH', orgApiPath(membership, `/branches/${branch.id}`), {
            body: { updatedAt: branch.updatedAt, ...body },
          })
        : api('POST', orgApiPath(membership, '/branches'), {
            body: { name: body.name, ...(body.address && { address: body.address }) },
          });
    },
    onSuccess: async () => {
      await refresh();
      toast(t(branch ? 'branches.saved' : 'branches.added'));
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.status === 409;
  const fields = fieldErrors(save.error);
  const other =
    save.error && !taken && !Object.keys(fields).length ? saveMessage(save.error) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setMissing(!name.trim());
    if (name.trim()) save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(branch ? 'branches.edit' : 'branches.add')}
      subtitle={branch ? undefined : t('branches.addHelp')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="branch-form" loading={save.isPending}>
            {t(branch ? 'branches.save' : 'branches.add')}
          </Button>
        </>
      }
    >
      <form id="branch-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('branches.field.name')}
          required
          maxLength={120}
          value={name}
          placeholder={t('branches.field.namePlaceholder')}
          error={
            missing
              ? t('courses.error.required')
              : taken
                ? t('branches.error.taken', { name: name.trim() })
                : fields.name
          }
          onChange={(e) => setName(e.target.value)}
        />
        <Field label={t('branches.field.address')} error={fields.address}>
          {(props) => (
            <textarea
              {...props}
              rows={3}
              maxLength={500}
              value={address}
              placeholder={t('branches.field.addressPlaceholder')}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        {other ? <Notice tone="danger">{other}</Notice> : null}
      </form>
    </Dialog>
  );
}

/** Add a room to a branch, or change its name and capacity. A room stays in its branch. */
function RoomDialog({
  branch,
  room,
  onClose,
}: {
  branch: Branch;
  room?: Room;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshBranches();
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState(
    room?.capacity === null ? '' : String(room?.capacity ?? ''),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), capacity: capacity ? Number(capacity) : null };
      return room
        ? api('PATCH', orgApiPath(membership, `/rooms/${room.id}`), {
            body: { updatedAt: room.updatedAt, ...body },
          })
        : api('POST', orgApiPath(membership, `/branches/${branch.id}/rooms`), { body });
    },
    onSuccess: async () => {
      await refresh();
      toast(t(room ? 'branches.room.saved' : 'branches.room.added'));
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.status === 409;
  const fields = fieldErrors(save.error);
  const other =
    save.error && !taken && !Object.keys(fields).length ? saveMessage(save.error) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('courses.error.required');
    const seats = Number(capacity);
    if (capacity && (!Number.isInteger(seats) || seats < 1 || seats > 1000)) {
      next.capacity = t('branches.error.capacity');
    }
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(room ? 'branches.room.edit' : 'branches.room.add')}
      subtitle={room ? undefined : t('branches.room.addHelp')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="room-form" loading={save.isPending}>
            {t(room ? 'branches.save' : 'branches.room.add')}
          </Button>
        </>
      }
    >
      <form id="room-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2.5 text-label">
          <span className="text-muted">{t('branches.field.branch')}</span>
          <b className="font-semibold text-text">{branch.name}</b>
        </div>
        <TextField
          label={t('branches.field.roomName')}
          required
          maxLength={120}
          value={name}
          placeholder={t('branches.field.roomPlaceholder')}
          error={
            errors.name ??
            (taken
              ? t('branches.error.roomTaken', { branch: branch.name, name: name.trim() })
              : fields.name)
          }
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('branches.field.capacity')}
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          value={capacity}
          placeholder={t('branches.noLimit')}
          helper={t('branches.field.capacityHelp')}
          error={errors.capacity ?? fields.capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
        {other ? <Notice tone="danger">{other}</Notice> : null}
      </form>
    </Dialog>
  );
}

/** The API's own words for a refusal (422), else the usual message. */
function saveMessage(error: unknown) {
  return error instanceof ApiError && error.status === 422 ? error.message : errorMessage(error);
}

/**
 * "Delete Albany branch?" Everything that still uses the branch is listed up front, with Delete
 * off: its rooms and classes, the families whose home it is, its own holidays, and staff limited
 * to it. The API refuses too (422), and says why, if these lists were out of date.
 */
function DeleteBranch({
  branch,
  last,
  rooms,
  classes,
  onClose,
}: {
  branch: Branch;
  last: boolean;
  rooms: number;
  classes: number;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshBranches();
  const people = usePeoplePaths();
  const base = orgPath(membership.org.slug);
  const orgId = membership.org.id;
  const families = useQuery({
    queryKey: ['families', orgId, { branchId: branch.id, count: true }],
    queryFn: ({ signal }) =>
      api<Page<Family>>(
        'GET',
        orgApiPath(membership, `/families?branchId=${branch.id}&limit=200`),
        { signal },
      ),
    enabled: !last,
  });
  const holidays = useQuery({
    queryKey: ['holidays', orgId],
    queryFn: ({ signal }) =>
      api<Page<Holiday>>('GET', orgApiPath(membership, '/holidays?limit=200'), { signal }),
    staleTime: 60_000,
    enabled: !last,
  });
  const staff = useQuery({
    queryKey: ['staff', orgId, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<StaffMember>>('GET', orgApiPath(membership, '/staff?limit=200'), { signal }),
    enabled: !last,
  });
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, `/branches/${branch.id}`)),
    onSuccess: async () => {
      await refresh();
      toast(t('branches.deleted', { name: branch.name }));
      onClose();
    },
  });

  const familyCount = families.data?.data.length ?? 0;
  const holidayCount = (holidays.data?.data ?? []).filter((h) => h.branchId === branch.id).length;
  const staffCount = (staff.data?.data ?? []).filter((m) =>
    m.branchIds?.includes(branch.id),
  ).length;
  const reasons: { text: string; to?: string }[] = [];
  if (rooms) reasons.push({ text: count(rooms, 'branches.uses.rooms.one', 'branches.uses.rooms') });
  if (classes) {
    reasons.push({
      text: count(classes, 'branches.classes.one', 'branches.classes'),
      to: `${base}/classes?branch=${branch.id}&term=all`,
    });
  }
  if (familyCount) {
    reasons.push({
      text: t(familyCount === 1 ? 'branches.uses.families.one' : 'branches.uses.families', {
        n: families.data?.nextCursor ? `${familyCount}+` : familyCount,
      }),
      to: `${people.list}?branch=${branch.id}`,
    });
  }
  if (holidayCount) {
    reasons.push({
      text: count(holidayCount, 'branches.uses.holidays.one', 'branches.uses.holidays'),
    });
  }
  if (staffCount) {
    reasons.push({
      text: count(staffCount, 'branches.uses.staff.one', 'branches.uses.staff'),
      to: `${base}/settings/team`,
    });
  }
  const checking = !last && (families.isPending || holidays.isPending || staff.isPending);
  const blocked = last || reasons.length > 0;
  const refused = run.error ? saveMessage(run.error) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('branches.deleteTitle', { name: branch.name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={run.isPending}
            disabled={blocked || checking}
            onClick={() => run.mutate()}
          >
            {t('branches.delete')}
          </Button>
        </>
      }
    >
      {last ? (
        <Notice tone="danger">{t('branches.lastBranch')}</Notice>
      ) : checking ? (
        <p className="text-body text-muted">{t('common.loading')}</p>
      ) : reasons.length ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-text">{t('branches.inUse')}</p>
          <Notice tone="danger" title={t('branches.moveFirst')}>
            <ul className="mt-1 flex flex-col gap-1">
              {reasons.map((reason) => (
                <li key={reason.text}>
                  {reason.to ? (
                    <Link to={reason.to} className="underline hover:no-underline">
                      {reason.text}
                    </Link>
                  ) : (
                    reason.text
                  )}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : (
        <p className="text-body text-text">{t('courses.delete.body')}</p>
      )}
      {refused ? (
        <Notice tone="danger" className="mt-4">
          {refused}
        </Notice>
      ) : null}
    </Dialog>
  );
}

/** "Delete Room 3?" Refused while a class is held there: those classes are listed, to move. */
function DeleteRoom({
  branch,
  room,
  classes,
  onClose,
}: {
  branch: Branch;
  room: Room;
  classes: Class[];
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const toast = useToast();
  const refresh = useRefreshBranches();
  const paths = useClassPaths();
  const run = useMutation({
    mutationFn: () => api('DELETE', orgApiPath(membership, `/rooms/${room.id}`)),
    onSuccess: async () => {
      await refresh();
      toast(t('branches.room.deleted', { name: room.name }));
      onClose();
    },
  });
  const refused = run.error ? saveMessage(run.error) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('branches.room.deleteTitle', { name: room.name })}
      subtitle={branch.name}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={run.isPending}
            disabled={classes.length > 0}
            onClick={() => run.mutate()}
          >
            {t('branches.room.delete')}
          </Button>
        </>
      }
    >
      {classes.length ? (
        <Notice
          tone="danger"
          title={t(classes.length === 1 ? 'branches.room.usedBy.one' : 'branches.room.usedBy', {
            name: room.name,
            n: classes.length,
          })}
        >
          <ul className="mt-1 flex flex-col gap-1">
            {classes.map((c) => (
              <li key={c.id}>
                <Link to={paths.class(c.id)} className="underline hover:no-underline">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2">{t('branches.room.moveFirst')}</p>
        </Notice>
      ) : (
        <p className="text-body text-text">{t('branches.room.unused')}</p>
      )}
      {refused ? (
        <Notice tone="danger" className="mt-4">
          {refused}
        </Notice>
      ) : null}
    </Dialog>
  );
}
