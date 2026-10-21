import { createRoute, z } from '@hono/zod-openapi';
import {
  AuditEntry,
  CreateImport,
  CreateUpload,
  Import,
  JobStarted,
  MapImport,
  FileWithLink,
  Job,
  PageQuery,
  UploadLink,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { decodeCursor, toPage } from '../../lib/pagination';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as repo from './repository';
import * as files from './files';
import * as imports from './imports';
import * as service from './service';

const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  tags: ['Platform'],
  summary: 'Liveness check',
  security: [],
  responses: {
    200: json(z.object({ ok: z.literal(true), environment: z.string() }), 'The API is up'),
  },
});

const getJobRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/jobs/{jobId}',
  tags: ['Platform'],
  summary: 'Poll a background job',
  description:
    'Long actions return `202 { jobId }`. Poll this until status is succeeded or failed. ' +
    'Only the person who started the job and the org owner can see it; anyone else gets 404.',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams.extend({ jobId: z.string() }) },
  responses: {
    200: json(Job, 'The job'),
    ...errors(401, 403, 404),
  },
});

const auditLogRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/audit-log',
  tags: ['Platform'],
  summary: 'Audit log, newest first',
  middleware: orgAccess('audit:read'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(AuditEntry).openapi('AuditLogPage'), 'A page of audit entries'),
    ...errors(400, 401, 403, 404),
  },
});

const FileParams = OrgParams.extend({
  fileId: z.string().openapi({ param: { name: 'fileId', in: 'path' } }),
});
const SignedQuery = z.object({ expires: z.string().optional(), sig: z.string().optional() });

const uploadUrlRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/files/upload-url',
  tags: ['Platform'],
  summary: 'Get a link to upload a file',
  description:
    'Makes the file’s record and a link to `PUT` its bytes to, good for 15 minutes. CSV, PDF, ' +
    'PNG or JPEG, at most 10 MB and no more than `size`. A file for an import is removed after ' +
    'a week. Teachers, parents and accountants get 403.',
  middleware: orgAccess('people:write'),
  request: { params: OrgParams, body: jsonBody(CreateUpload) },
  responses: {
    201: json(UploadLink, 'The file and its upload link'),
    ...errors(400, 401, 403, 404, 503),
  },
});

const getFileRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/files/{fileId}',
  tags: ['Platform'],
  summary: 'Get a file, with a link to download it',
  description:
    'The link is good for 5 minutes. Only the member who uploaded the file and the owner can ' +
    'get it; anyone else gets 404.',
  middleware: orgAccess('org:read'),
  request: { params: FileParams },
  responses: { 200: json(FileWithLink, 'The file'), ...errors(401, 403, 404, 503) },
});

const putContentRoute = createRoute({
  method: 'put',
  path: '/api/v1/files/{fileId}/content',
  tags: ['Platform'],
  summary: 'Upload a file’s bytes through its signed link',
  description:
    'No sign-in: the link’s signature is the proof. A link that is wrong or past its time is 404.',
  security: [],
  request: {
    params: z.object({ fileId: z.string().openapi({ param: { name: 'fileId', in: 'path' } }) }),
    query: SignedQuery,
  },
  responses: { 204: { description: 'Stored' }, ...errors(400, 404, 503) },
});

const getContentRoute = createRoute({
  method: 'get',
  path: '/api/v1/files/{fileId}/content',
  tags: ['Platform'],
  summary: 'Download a file through its signed link',
  security: [],
  request: {
    params: z.object({ fileId: z.string().openapi({ param: { name: 'fileId', in: 'path' } }) }),
    query: SignedQuery,
  },
  responses: {
    200: {
      description: 'The file',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...errors(404, 503),
  },
});

const ImportParams = OrgParams.extend({
  importId: z.string().openapi({ param: { name: 'importId', in: 'path' } }),
});

const createImportRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/imports',
  tags: ['Platform'],
  summary: 'Start a spreadsheet import',
  description:
    'From an uploaded CSV (`POST /files/upload-url`, then PUT): its first row is the headers. ' +
    'Answers with the headers, the row count and the first 5 rows, to map. One row is one ' +
    'student, with their family and a guardian. At most 1000 rows (422).',
  middleware: orgAccess('people:write'),
  request: { params: OrgParams, body: jsonBody(CreateImport) },
  responses: { 201: json(Import, 'The import'), ...errors(400, 401, 403, 404, 422) },
});

const getImportRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/imports/{importId}',
  tags: ['Platform'],
  summary: 'Get an import',
  description: 'For whoever started it and the owner; anyone else gets 404.',
  middleware: orgAccess('people:write'),
  request: { params: ImportParams },
  responses: { 200: json(Import, 'The import'), ...errors(401, 403, 404) },
});

const mapImportRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/imports/{importId}',
  tags: ['Platform'],
  summary: 'Map an import’s columns, and check every row',
  description:
    'Column header → field, and a default home branch for rows with none. Every row is checked: ' +
    'names, dates (`YYYY-MM-DD`, or day/month/year in the organisation’s date format), branch ' +
    'and grade level names, emails and phones. `problems` lists the first 100; with none the ' +
    'import is `ready`. Branch staff can only import into their own branches.',
  middleware: orgAccess('people:write'),
  request: { params: ImportParams, body: jsonBody(MapImport) },
  responses: { 200: json(Import, 'The import, checked'), ...errors(400, 401, 403, 404, 409, 422) },
});

const commitImportRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/imports/{importId}/commit',
  tags: ['Platform'],
  summary: 'Add an import’s families and students (job)',
  description:
    'For a `ready` import (422 otherwise). Rows with the same family name, branch and guardian ' +
    'email are one family. Everything is added in one go, or nothing. Returns `202 { jobId }`.',
  middleware: orgAccess('people:write'),
  request: { params: ImportParams },
  responses: { 202: json(JobStarted, 'The commit is running'), ...errors(401, 403, 404, 409, 422) },
});

const originOf = (url: string) => new URL(url).origin;

export const platformRoutes = createRouter()
  .openapi(createImportRoute, async (c) => {
    return c.json(await imports.createImport(orgCtx(c), c.env, c.req.valid('json').fileId), 201);
  })
  .openapi(getImportRoute, async (c) => {
    const { importId } = c.req.valid('param');
    return c.json(await imports.getImport(orgCtx(c), c.env, access(c), importId), 200);
  })
  .openapi(mapImportRoute, async (c) => {
    const { importId } = c.req.valid('param');
    return c.json(
      await imports.mapImport(orgCtx(c), c.env, access(c), importId, c.req.valid('json')),
      200,
    );
  })
  .openapi(commitImportRoute, async (c) => {
    const { importId } = c.req.valid('param');
    const jobId = await imports.commitImport(orgCtx(c), access(c), c.env.JOBS_QUEUE, importId);
    return c.json({ jobId }, 202);
  })
  .openapi(uploadUrlRoute, async (c) => {
    const link = await files.createUpload(
      orgCtx(c),
      c.env,
      originOf(c.req.url),
      c.req.valid('json'),
    );
    return c.json(link, 201);
  })
  .openapi(getFileRoute, async (c) => {
    const { fileId } = c.req.valid('param');
    const file = await files.getFile(
      orgCtx(c),
      c.env,
      originOf(c.req.url),
      c.var.membership.role,
      fileId,
    );
    return c.json(file, 200);
  })
  .openapi(putContentRoute, async (c) => {
    const length = c.req.header('Content-Length');
    await files.receiveUpload(
      c.var.db,
      c.env,
      c.req.valid('param').fileId,
      c.req.valid('query'),
      c.req.raw.body,
      length ? Number(length) : null,
    );
    return c.body(null, 204);
  })
  .openapi(getContentRoute, async (c) => {
    const { row, body } = await files.download(
      c.var.db,
      c.env,
      c.req.valid('param').fileId,
      c.req.valid('query'),
    );
    return c.body(body, 200, {
      'Content-Type': row.contentType,
      'Content-Disposition': `attachment; filename="${row.filename.replaceAll('"', '')}"`,
    });
  })
  .openapi(healthRoute, (c) => c.json({ ok: true as const, environment: c.env.ENVIRONMENT }, 200))
  .openapi(getJobRoute, async (c) => {
    const job = await service.getJob(orgCtx(c), c.var.membership.role, c.req.valid('param').jobId);
    return c.json(job, 200);
  })
  .openapi(auditLogRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    const rows = await repo.listAudit(orgCtx(c), limit, decodeCursor(cursor));
    const { data, nextCursor } = toPage(rows, limit);
    return c.json(
      {
        data: data.map(({ orgId: _org, ...entry }) => ({
          ...entry,
          before: entry.before ?? null,
          after: entry.after ?? null,
        })),
        nextCursor,
      },
      200,
    );
  });
