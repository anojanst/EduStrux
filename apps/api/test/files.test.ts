import { files, memberships } from '@edustrux/db';
import { newId, type Role } from '@edustrux/shared';
import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cleanExpired } from '../src/modules/platform/files';
import { call, db, newOrg, newUser } from './helpers';

// File uploads to R2 through signed links (TUI-61).

type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const member = async (role: Role) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({
        id: newId('membership'),
        orgId: org.id,
        userId: user.userId,
        role,
        branchIds: null,
      });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  return { org, base, api, member };
}

/** Sends to a signed link, as a browser would: no sign-in. */
async function raw(
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string> = {},
) {
  const res = await exports.default.fetch(new Request(url, { method, body, headers }));
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const CSV = 'first,last\nAroha,Perera\n';

describe('file uploads', () => {
  it('uploads through a signed link and downloads through another', async () => {
    const { api, org } = await setup();
    const link = await api('POST', '/files/upload-url', {
      filename: 'students.csv',
      contentType: 'text/csv',
      size: CSV.length,
    });
    expect(link.status).toBe(201);
    expect(link.body).toEqual({
      file: {
        id: expect.stringMatching(/^fil_/),
        purpose: 'import',
        filename: 'students.csv',
        contentType: 'text/csv',
        size: null,
        status: 'pending',
        expiresAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      uploadUrl: expect.stringMatching(
        /^http:\/\/api\.test\/api\/v1\/files\/fil_\w+\/content\?expires=\d+&sig=[0-9a-f]{64}$/,
      ),
      expiresAt: expect.any(String),
    });
    const id = link.body.file.id as string;
    const before = await api('GET', `/files/${id}`);
    expect(before.body).toMatchObject({ status: 'pending', downloadUrl: null });

    const put = await raw('PUT', link.body.uploadUrl, CSV, { 'Content-Type': 'text/csv' });
    expect(put.status).toBe(204);
    const stored = await env.FILES.get(`orgs/${org.id}/files/${id}`);
    expect(await stored!.text()).toBe(CSV);

    const after = await api('GET', `/files/${id}`);
    expect(after.body).toMatchObject({ status: 'uploaded', size: CSV.length });
    const got = await raw('GET', after.body.downloadUrl);
    expect(got.status).toBe(200);
    expect(got.text).toBe(CSV);
    expect(got.headers.get('Content-Disposition')).toBe('attachment; filename="students.csv"');
  });

  it('refuses a link that is tampered with or too big an upload', async () => {
    const { api } = await setup();
    const link = (
      await api('POST', '/files/upload-url', {
        filename: 'a.csv',
        contentType: 'text/csv',
        size: 5,
      })
    ).body;
    const url = link.uploadUrl as string;
    const tampered = url.slice(0, -1) + (url.endsWith('0') ? '1' : '0');
    expect((await raw('PUT', tampered, 'a')).status).toBe(404);
    const otherFile = link.uploadUrl.replace(link.file.id, 'fil_other');
    expect((await raw('PUT', otherFile, 'a')).status).toBe(404);
    const tooBig = await raw('PUT', link.uploadUrl, '0123456789');
    expect(tooBig.status).toBe(400);
    // A download link can't be made from an upload link: the method is signed too.
    expect((await raw('GET', link.uploadUrl)).status).toBe(404);
  });

  it('refuses bad requests, and keeps a file to its uploader and the owner', async () => {
    const { api, member } = await setup();
    const post = (body: Record<string, unknown>) => api('POST', '/files/upload-url', body);
    expect(
      (await post({ filename: 'a.exe', contentType: 'application/x-msdownload', size: 5 })).status,
    ).toBe(400);
    expect((await post({ filename: '../a.csv', contentType: 'text/csv', size: 5 })).status).toBe(
      400,
    );
    expect(
      (await post({ filename: 'a.csv', contentType: 'text/csv', size: 11 * 1024 * 1024 })).status,
    ).toBe(400);
    expect(
      (await post({ filename: 'a.csv', contentType: 'text/csv', size: 5, purpose: 'export' }))
        .status,
    ).toBe(400);

    const desk = await member('front_desk');
    const theirs = (
      await desk.as('POST', '/files/upload-url', {
        filename: 'a.csv',
        contentType: 'text/csv',
        size: 5,
      })
    ).body;
    expect((await desk.as('GET', `/files/${theirs.file.id}`)).status).toBe(200);
    expect((await api('GET', `/files/${theirs.file.id}`)).status).toBe(200);
    const other = await member('branch_manager');
    expect((await other.as('GET', `/files/${theirs.file.id}`)).status).toBe(404);
    for (const role of ['teacher', 'parent', 'accountant'] as const) {
      expect(
        (
          await (
            await member(role)
          ).as('POST', '/files/upload-url', { filename: 'a.csv', contentType: 'text/csv', size: 5 })
        ).status,
      ).toBe(403);
    }
    const stranger = await setup();
    expect((await stranger.api('GET', `/files/${theirs.file.id}`)).status).toBe(404);
  });

  it('removes files past their expiry, in the daily clean-up', async () => {
    const { api } = await setup();
    const link = (
      await api('POST', '/files/upload-url', {
        filename: 'a.csv',
        contentType: 'text/csv',
        size: 5,
      })
    ).body;
    await raw('PUT', link.uploadUrl, 'a,b\n');
    await db()
      .update(files)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(files.id, link.file.id));
    expect(await cleanExpired(db(), env)).toBeGreaterThanOrEqual(1);
    expect((await api('GET', `/files/${link.file.id}`)).status).toBe(404);
  });
});
