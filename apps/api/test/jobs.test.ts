import { jobs } from '@edustrux/db';
import type { Role } from '@edustrux/shared';
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_HANDLERS, JOBS_MAX_RETRIES, runJob, type JobContext } from '../src/background/jobs';
import type { JobMessage } from '../src/background/messages';
import { handleQueue } from '../src/background/queue';
import { startJob } from '../src/modules/platform/service';
import { addMember, call, db, newOrg, newUser } from './helpers';

const TYPE = 'test.echo';

function fakeQueue(fail = false) {
  const sent: JobMessage[] = [];
  const queue = {
    send: async (message: JobMessage) => {
      if (fail) throw new Error('queue unavailable');
      sent.push(message);
    },
  } as unknown as Queue<JobMessage>;
  return { queue, sent };
}

async function newOrgWithMember(role: Role) {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const member = await newUser(role);
  await addMember(org.id, member.clerkUserId, role);
  return { owner, org, member };
}

/** Starts a job as `userId` (null = started by the system, e.g. a cron). */
async function start(orgId: string, userId: string | null, input: unknown = { term: 'T1' }) {
  const { queue, sent } = fakeQueue();
  const jobId = await startJob({ db: db(), orgId, actorUserId: userId }, queue, TYPE, input);
  return { jobId, message: sent[0]! };
}

const jobRow = (jobId: string) =>
  db().query.jobs.findFirst({ where: (j, { eq }) => eq(j.id, jobId) });

const poll = (orgId: string, jobId: string, token: string) =>
  call('GET', `/api/v1/orgs/${orgId}/jobs/${jobId}`, { token });

afterEach(() => {
  delete JOB_HANDLERS[TYPE];
  vi.restoreAllMocks();
});

describe('GET /jobs/{jobId}', () => {
  it('shows the person who started a job its progress, then its result', async () => {
    const { org, member } = await newOrgWithMember('accountant');
    const { jobId, message } = await start(org.id, member.userId);

    const queued = await poll(org.id, jobId, member.token);
    expect(queued.status).toBe(200);
    expect(queued.body).toEqual({
      id: jobId,
      type: TYPE,
      status: 'queued',
      progress: 0,
      attempts: 0,
      result: null,
      error: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    JOB_HANDLERS[TYPE] = async () => ({ invoices: 12 });
    await runJob(db(), env, message, 1);

    const done = await poll(org.id, jobId, member.token);
    expect(done.body).toMatchObject({
      status: 'succeeded',
      progress: 100,
      attempts: 1,
      result: { invoices: 12 },
      error: null,
    });
  });

  it('lets the owner see any job in the org, including ones the system started', async () => {
    const { owner, org, member } = await newOrgWithMember('accountant');
    const byMember = await start(org.id, member.userId);
    const bySystem = await start(org.id, null);

    expect((await poll(org.id, byMember.jobId, owner.token)).status).toBe(200);
    expect((await poll(org.id, bySystem.jobId, owner.token)).status).toBe(200);
    expect((await poll(org.id, bySystem.jobId, member.token)).status).toBe(404);
  });

  it.each<Role>(['branch_manager', 'front_desk', 'accountant', 'teacher', 'parent'])(
    "gives a %s the same 404 for someone else's job as for a missing one",
    async (role) => {
      const { org, member: starter } = await newOrgWithMember('front_desk');
      const other = await newUser(role);
      const otherToken = await addMember(org.id, other.clerkUserId, role);
      const { jobId } = await start(org.id, starter.userId);

      const theirs = await poll(org.id, jobId, otherToken);
      const missing = await poll(org.id, 'job_doesnotexist', otherToken);

      expect(theirs.status).toBe(404);
      expect(theirs.body).toEqual(missing.body);
    },
  );

  it("can't read another org's job, even as the owner of your own org", async () => {
    const alice = await newUser('alice');
    const alicesOrg = await newOrg(alice.token, 'Alice Academy');
    const bob = await newUser('bob');
    const bobsOrg = await newOrg(bob.token, 'Bob Tutoring');
    const { jobId } = await start(alicesOrg.id, alice.userId);

    expect((await poll(bobsOrg.id, jobId, bob.token)).status).toBe(404);
    expect((await poll(alicesOrg.id, jobId, bob.token)).status).toBe(404);
    expect((await poll(alicesOrg.id, jobId, alice.token)).status).toBe(200);
  });

  it('is documented in the OpenAPI spec, with attempts on the Job schema', async () => {
    const spec = await call('GET', '/api/openapi.json');
    expect(spec.body.paths['/api/v1/orgs/{orgId}/jobs/{jobId}'].get).toBeDefined();
    expect(spec.body.components.schemas.Job.required).toEqual(
      expect.arrayContaining(['status', 'progress', 'attempts', 'error']),
    );
  });
});

describe('startJob', () => {
  it('records a queued job with an audit row and sends it to the queue', async () => {
    const { owner, org, member } = await newOrgWithMember('accountant');
    const { queue, sent } = fakeQueue();

    const jobId = await startJob(
      { db: db(), orgId: org.id, actorUserId: member.userId },
      queue,
      TYPE,
      { termId: 'trm_1' },
    );

    expect(jobId).toMatch(/^job_/);
    expect(sent).toEqual([{ orgId: org.id, jobId }]);
    expect(await jobRow(jobId)).toMatchObject({
      orgId: org.id,
      type: TYPE,
      status: 'queued',
      input: { termId: 'trm_1' },
      createdByUserId: member.userId,
    });

    const audit = await call('GET', `/api/v1/orgs/${org.id}/audit-log`, { token: owner.token });
    expect(audit.body.data[0]).toMatchObject({
      action: 'job.started',
      entityType: 'job',
      entityId: jobId,
      actorUserId: member.userId,
      after: { type: TYPE, input: { termId: 'trm_1' } },
    });
  });

  it("marks the job failed if it can't be queued, so it isn't left queued forever", async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { queue } = fakeQueue(true);
    const ctx = { db: db(), orgId: org.id, actorUserId: owner.userId };

    await expect(startJob(ctx, queue, TYPE)).rejects.toThrow('queue unavailable');

    const row = await db().query.jobs.findFirst({
      where: (j, { and, eq }) => and(eq(j.orgId, org.id), eq(j.type, TYPE)),
    });
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/queue/i) });
  });
});

describe('runJob', () => {
  it('runs a queued job to succeeded, tracking progress and storing the result', async () => {
    const { org, member } = await newOrgWithMember('accountant');
    const { jobId, message } = await start(org.id, member.userId, { termId: 'trm_1' });
    const seen: Record<string, unknown> = {};

    JOB_HANDLERS[TYPE] = async (ctx: JobContext) => {
      seen.ctx = { orgId: ctx.orgId, actorUserId: ctx.actorUserId, jobId: ctx.jobId };
      seen.input = ctx.input;
      seen.statusWhileRunning = (await jobRow(jobId))!.status;
      await ctx.setProgress(42.4);
      seen.progress = (await jobRow(jobId))!.progress;
      await ctx.setProgress(250); // 100 is kept for "finished"
      seen.cappedProgress = (await jobRow(jobId))!.progress;
      return { invoices: 3 };
    };
    await runJob(db(), env, message, 1);

    expect(seen).toEqual({
      ctx: { orgId: org.id, actorUserId: member.userId, jobId },
      input: { termId: 'trm_1' },
      statusWhileRunning: 'running',
      progress: 42,
      cappedProgress: 99,
    });
    expect(await jobRow(jobId)).toMatchObject({
      status: 'succeeded',
      progress: 100,
      attempts: 1,
      result: { invoices: 3 },
      error: null,
    });
  });

  it('puts a failed try back to queued with its error while retries remain, and rethrows', async () => {
    const { org, member } = await newOrgWithMember('accountant');
    const { jobId, message } = await start(org.id, member.userId);
    JOB_HANDLERS[TYPE] = async (ctx) => {
      await ctx.setProgress(50);
      throw new Error('Paddle is down');
    };

    await expect(runJob(db(), env, message, 1)).rejects.toThrow('Paddle is down');

    expect(await jobRow(jobId)).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: 'Paddle is down',
    });
  });

  it('marks the job failed only when the last try fails, without throwing', async () => {
    const { org, member } = await newOrgWithMember('accountant');
    const { jobId, message } = await start(org.id, member.userId);
    JOB_HANDLERS[TYPE] = async () => {
      throw new Error('Still down');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    for (let attempt = 1; attempt <= JOBS_MAX_RETRIES; attempt++) {
      await expect(runJob(db(), env, message, attempt)).rejects.toThrow('Still down');
      expect((await jobRow(jobId))!.status).toBe('queued');
    }
    await runJob(db(), env, message, JOBS_MAX_RETRIES + 1);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'failed',
      attempts: JOBS_MAX_RETRIES + 1,
      error: 'Still down',
    });
  });

  it('restarts progress on a retry and clears the last error when it succeeds', async () => {
    const { org, member } = await newOrgWithMember('accountant');
    const { jobId, message } = await start(org.id, member.userId);
    let calls = 0;
    let progressAtRetryStart: number | undefined;
    JOB_HANDLERS[TYPE] = async (ctx) => {
      calls++;
      if (calls === 1) {
        await ctx.setProgress(60);
        throw new Error('Timeout');
      }
      progressAtRetryStart = (await jobRow(jobId))!.progress;
      return 'ok';
    };

    await expect(runJob(db(), env, message, 1)).rejects.toThrow('Timeout');
    await runJob(db(), env, message, 2);

    expect(progressAtRetryStart).toBe(0);
    expect(await jobRow(jobId)).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      result: 'ok',
      error: null,
    });
  });

  it('fails a job with no registered handler straight away, without retrying', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { jobId, message } = await start(org.id, owner.userId);

    await runJob(db(), env, message, 1);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: `No handler for job type "${TYPE}"`,
    });
  });

  it.each(['succeeded', 'failed'] as const)(
    'does nothing when a %s job is delivered again',
    async (status) => {
      const owner = await newUser('owner');
      const org = await newOrg(owner.token);
      const { jobId, message } = await start(org.id, owner.userId);
      await db()
        .update(jobs)
        .set({ status, attempts: 2, result: status === 'succeeded' ? 'done' : null })
        .where(eq(jobs.id, jobId));
      const before = await jobRow(jobId);
      const handler = vi.fn(async () => 'again');
      JOB_HANDLERS[TYPE] = handler;

      await runJob(db(), env, message, 3);

      expect(handler).not.toHaveBeenCalled();
      expect(await jobRow(jobId)).toEqual(before);
    },
  );

  it("ignores a message whose org doesn't match the job's org", async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { jobId } = await start(org.id, owner.userId);
    const handler = vi.fn(async () => 'x');
    JOB_HANDLERS[TYPE] = handler;

    await runJob(db(), env, { orgId: 'org_someoneelse', jobId }, 1);

    expect(handler).not.toHaveBeenCalled();
    expect((await jobRow(jobId))!.status).toBe('queued');
  });
});

describe('jobs queue consumer', () => {
  async function deliver(message: JobMessage, attempts: number) {
    const batch = createMessageBatch<JobMessage>('edustrux-jobs', [
      { id: 'msg-1', timestamp: new Date(), attempts, body: message },
    ]);
    // getQueueResult() reports which messages were retried but not their delay, so spy on it.
    const retry = vi.spyOn(batch.messages[0]!, 'retry');
    await handleQueue(batch, env);
    const result = await getQueueResult(batch, createExecutionContext());
    return { ...result, retryDelays: retry.mock.calls.map(([options]) => options?.delaySeconds) };
  }

  it('acks the message when the job runs', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { jobId, message } = await start(org.id, owner.userId);
    JOB_HANDLERS[TYPE] = async () => 'ok';

    const result = await deliver(message, 1);

    expect(result.explicitAcks).toEqual(['msg-1']);
    expect(result.retryMessages).toEqual([]);
    expect((await jobRow(jobId))!.status).toBe('succeeded');
  });

  it('retries a failed try with exponential backoff', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { jobId, message } = await start(org.id, owner.userId);
    JOB_HANDLERS[TYPE] = async () => {
      throw new Error('boom');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await deliver(message, 1);
    const second = await deliver(message, 2);

    expect(first.retryMessages).toEqual([{ msgId: 'msg-1' }]);
    expect(first.explicitAcks).toEqual([]);
    expect([...first.retryDelays, ...second.retryDelays]).toEqual([120, 240]);
    expect((await jobRow(jobId))!.status).toBe('queued');
  });

  it('acks the message when the last try fails, leaving the job failed', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const { jobId, message } = await start(org.id, owner.userId);
    JOB_HANDLERS[TYPE] = async () => {
      throw new Error('boom');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await deliver(message, JOBS_MAX_RETRIES + 1);

    expect(result.explicitAcks).toEqual(['msg-1']);
    expect(result.retryMessages).toEqual([]);
    expect((await jobRow(jobId))!.status).toBe('failed');
  });
});
