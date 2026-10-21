import { jobs, sessions } from '@edustrux/db';
import { OPEN_ENDED_HORIZON_DAYS, addDays, localNow, localToUtc } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { and, eq, isNull, max } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { runDaily } from '../src/background/scheduled';
import { BACKUP_KEEP_DAYS } from '../src/modules/platform/exports';
import { call, db, newOrg, newUser } from './helpers';

// The daily cron (TUI-68): open-ended classes' sessions kept ahead, and nightly backups.

const TZ = 'Pacific/Auckland';
const today = () => localNow(TZ).date;
/** Noon on a date, in the org's time zone. */
const noonOn = (date: string) => new Date(localToUtc(date, '12:00', TZ));

type Row = { id: string; updatedAt: string };

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  const subject = await make('/subjects', { name: 'Mathematics' });
  const grade = await make('/grade-levels', { name: 'Year 10' });
  const course = await make('/courses', { subjectId: subject.id, gradeLevelId: grade.id });
  const addClass = async (name: string, body: Record<string, unknown>) => {
    const klass = await make('/classes', { courseId: course.id, branchId: main.id, name, ...body });
    await api('PUT', `/classes/${klass.id}/schedule`, {
      slots: [{ weekday: 2, startTime: '16:00', endTime: '17:00' }],
    });
    return klass;
  };
  /** The date of the class's last session. */
  const lastLesson = async (classId: string) =>
    (
      await db()
        .select({ last: max(sessions.date) })
        .from(sessions)
        .where(and(eq(sessions.classId, classId), isNull(sessions.deletedAt)))
        .get()
    )?.last ?? null;
  return { org, api, addClass, lastLesson };
}

describe('the daily cron', () => {
  it('keeps open-ended classes’ sessions generated ahead, and leaves ended ones', async () => {
    const { addClass, lastLesson, api } = await setup();
    const open = await addClass('Open', { startDate: addDays(today(), -7) });
    const ending = await addClass('Ending', {
      startDate: addDays(today(), -7),
      endDate: addDays(today(), 20),
    });
    const before = await lastLesson(open.id);
    expect(before! > addDays(today(), OPEN_ENDED_HORIZON_DAYS - 7)).toBe(true);
    const endingBefore = await lastLesson(ending.id);

    const later = addDays(today(), 28);
    const done = await runDaily(db(), env, noonOn(later));
    expect(done.sessionsAdded).toBeGreaterThanOrEqual(4);
    const after = await lastLesson(open.id);
    expect(after! > addDays(later, OPEN_ENDED_HORIZON_DAYS - 7)).toBe(true);
    expect(after! <= addDays(later, OPEN_ENDED_HORIZON_DAYS)).toBe(true);
    expect(await lastLesson(ending.id)).toBe(endingBefore);

    // Again on the same day: nothing to add.
    await runDaily(db(), env, noonOn(later));
    expect(await lastLesson(open.id)).toBe(after);
    const audit = (await api('GET', '/audit-log?limit=20')).body.data.filter(
      (a: { action: string }) => a.action === 'class.sessions_extended',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: open.id, actorUserId: null });
  });

  it('backs each org up to R2, keeping two weeks of nights', async () => {
    const { org } = await setup();
    const prefix = `backups/${org.id}/`;
    const stale = `${prefix}${addDays(today(), -BACKUP_KEEP_DAYS)}.json`;
    const kept = `${prefix}${addDays(today(), -(BACKUP_KEEP_DAYS - 1))}.json`;
    await env.FILES.put(stale, '{}');
    await env.FILES.put(kept, '{}');

    await runDaily(db(), env, noonOn(today()));
    let job;
    for (let i = 0; i < 400; i++) {
      job = await db()
        .select()
        .from(jobs)
        .where(and(eq(jobs.orgId, org.id), eq(jobs.type, 'exports.backup')))
        .get();
      if (job?.status === 'succeeded' || job?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(job).toMatchObject({ status: 'succeeded', createdByUserId: null });

    const backup = await env.FILES.get(`${prefix}${today()}.json`);
    const doc = JSON.parse(await backup!.text());
    expect(doc).toMatchObject({ format: 'edustrux-export', org: { id: org.id } });
    expect(doc.tables.branches).toHaveLength(1);
    expect(await env.FILES.head(stale)).toBeNull();
    expect(await env.FILES.head(kept)).not.toBeNull();
  });
});
