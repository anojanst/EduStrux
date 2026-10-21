import { newId, type CreateUpload, type Role, type StoredFile } from '@edustrux/shared';
import type { Db } from '@edustrux/db';
import type { OrgCtx } from '../../db/scope';
import type { Bindings } from '../../env';
import { notFound, unavailable, validationFailed } from '../../lib/errors';
import { sign, verify } from '../../lib/signing';
import * as repo from './repository';

// Files in R2 under `orgs/{orgId}/files/{id}`, reached through short-lived links the Worker
// signs and serves itself (TUI-61): no R2 credentials leave it.

/** An upload link is good for 15 minutes, a download link for 5. */
const UPLOAD_SECONDS = 15 * 60;
const DOWNLOAD_SECONDS = 5 * 60;
/** Files uploaded for an import are removed after a week. */
const IMPORT_DAYS = 7;

export function toFile(row: repo.FileRow): StoredFile {
  return {
    id: row.id,
    purpose: row.purpose,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function secretOf(env: Bindings) {
  if (!env.FILES_SIGNING_SECRET) throw unavailable('File links are not set up yet.');
  return env.FILES_SIGNING_SECRET;
}

/** A signed link to a file's content: `PUT` to upload it, `GET` to download it. */
async function link(
  env: Bindings,
  origin: string,
  method: 'PUT' | 'GET',
  id: string,
  seconds: number,
) {
  const expires = Math.floor(Date.now() / 1000) + seconds;
  const sig = await sign(secretOf(env), `${method}:${id}:${expires}`);
  return {
    url: `${origin}/api/v1/files/${id}/content?expires=${expires}&sig=${sig}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/** Makes the file's row and the link to upload it through. */
export async function createUpload(
  ctx: OrgCtx,
  env: Bindings,
  origin: string,
  input: CreateUpload,
) {
  secretOf(env);
  const id = newId('file');
  const row = await repo.insertFile(ctx, {
    id,
    orgId: ctx.orgId,
    purpose: input.purpose,
    filename: input.filename,
    contentType: input.contentType,
    maxSize: input.size,
    r2Key: `orgs/${ctx.orgId}/files/${id}`,
    status: 'pending',
    uploadedByUserId: ctx.actorUserId,
    expiresAt:
      input.purpose === 'import'
        ? new Date(Date.now() + IMPORT_DAYS * 86_400_000).toISOString()
        : null,
  });
  const upload = await link(env, origin, 'PUT', id, UPLOAD_SECONDS);
  return { file: toFile(row), uploadUrl: upload.url, expiresAt: upload.expiresAt };
}

/**
 * A file with a link to download it, for the member who uploaded it and the owner; anyone else
 * gets 404, as for jobs (D-018).
 */
export async function getFile(ctx: OrgCtx, env: Bindings, origin: string, role: Role, id: string) {
  const row = await repo.findFile(ctx, id);
  if (!row || (role !== 'owner' && row.uploadedByUserId !== ctx.actorUserId)) {
    throw notFound('File');
  }
  if (row.status !== 'uploaded') {
    return { ...toFile(row), downloadUrl: null, downloadExpiresAt: null };
  }
  const download = await link(env, origin, 'GET', id, DOWNLOAD_SECONDS);
  return { ...toFile(row), downloadUrl: download.url, downloadExpiresAt: download.expiresAt };
}

/** The file a signed link names, if the signature and its expiry hold. 404 otherwise. */
async function signedFile(
  db: Db,
  env: Bindings,
  method: 'PUT' | 'GET',
  id: string,
  query: { expires?: string; sig?: string },
) {
  const expires = Number(query.expires);
  const fresh = Number.isFinite(expires) && expires * 1000 > Date.now();
  if (
    !fresh ||
    !query.sig ||
    !(await verify(secretOf(env), `${method}:${id}:${expires}`, query.sig))
  ) {
    throw notFound('File');
  }
  const row = await repo.findFileBySignedLink(db, id);
  if (!row) throw notFound('File');
  return row;
}

/** Stores an upload in R2. Bigger than the size given when the link was made is 400. */
export async function receiveUpload(
  db: Db,
  env: Bindings,
  id: string,
  query: { expires?: string; sig?: string },
  body: ReadableStream | null,
  contentLength: number | null,
) {
  const row = await signedFile(db, env, 'PUT', id, query);
  if (row.status === 'uploaded') return;
  if (!body) throw validationFailed({ body: ['Required'] });
  if (contentLength !== null && contentLength > row.maxSize) {
    throw validationFailed({ body: [`At most ${row.maxSize} bytes`] });
  }
  const bytes = await new Response(body).arrayBuffer();
  if (bytes.byteLength > row.maxSize) {
    throw validationFailed({ body: [`At most ${row.maxSize} bytes`] });
  }
  await env.FILES.put(row.r2Key, bytes, { httpMetadata: { contentType: row.contentType } });
  await repo.markUploaded(db, id, bytes.byteLength);
}

/** The file's bytes, for a signed download link. */
export async function download(
  db: Db,
  env: Bindings,
  id: string,
  query: { expires?: string; sig?: string },
) {
  const row = await signedFile(db, env, 'GET', id, query);
  const object = row.status === 'uploaded' ? await env.FILES.get(row.r2Key) : null;
  if (!object) throw notFound('File');
  return { row, body: object.body };
}

/** A file's bytes, for code that has its row: an import reading its spreadsheet. */
export async function contentOf(ctx: OrgCtx, env: Bindings, id: string) {
  const row = await repo.findFile(ctx, id);
  if (!row || row.status !== 'uploaded') return null;
  const object = await env.FILES.get(row.r2Key);
  return object ? { row, text: await object.text() } : null;
}

/** Stores bytes the API made itself, such as an export, as a file of the org. */
export async function storeFile(
  ctx: OrgCtx,
  env: Bindings,
  file: {
    filename: string;
    contentType: string;
    body: string | ArrayBuffer;
    expiresAt: string | null;
  },
) {
  const id = newId('file');
  const r2Key = `orgs/${ctx.orgId}/files/${id}`;
  const size =
    typeof file.body === 'string'
      ? new TextEncoder().encode(file.body).byteLength
      : file.body.byteLength;
  await env.FILES.put(r2Key, file.body, { httpMetadata: { contentType: file.contentType } });
  return repo.insertFile(ctx, {
    id,
    orgId: ctx.orgId,
    purpose: 'export',
    filename: file.filename,
    contentType: file.contentType,
    maxSize: size,
    size,
    r2Key,
    status: 'uploaded',
    uploadedByUserId: ctx.actorUserId,
    expiresAt: file.expiresAt,
  });
}

/** Removes the files past their expiry from R2 and the database. For the daily cron. */
export async function cleanExpired(db: Db, env: Bindings) {
  let removed = 0;
  for (;;) {
    const batch = await repo.expiredFiles(db, new Date().toISOString(), 100);
    if (batch.length === 0) break;
    await env.FILES.delete(batch.map((f) => f.r2Key));
    await repo.softDeleteFiles(
      db,
      batch.map((f) => f.id),
    );
    removed += batch.length;
    if (batch.length < 100) break;
  }
  return removed;
}
