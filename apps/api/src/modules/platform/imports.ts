import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  newId,
  normaliseName,
  type Import,
  type ImportField,
  type MapImport,
  type Org,
} from '@edustrux/shared';
import type { JobContext } from '../../background/jobs';
import type { JobMessage } from '../../background/messages';
import type { Access, OrgCtx } from '../../db/scope';
import type { Bindings } from '../../env';
import { conflict, notFound, staleData, unprocessable, validationFailed } from '../../lib/errors';
import { parseCsv } from '../../lib/csv';
import * as branches from '../branches/service';
import * as calendar from '../calendar/service';
import * as curriculum from '../curriculum/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';
import { contentOf } from './files';
import * as repo from './repository';
import { startJob } from './service';

// Spreadsheet import with manual column mapping (TUI-60): upload a CSV, read its columns, map
// them to fields, check every row, then commit it as a job.

/** The job type of an import's commit. */
export const IMPORT_COMMIT = 'imports.commit';

const MAX_PROBLEMS = 100;

/** The sheet's header and rows: the file's CSV, its first row the headers. */
async function sheetOf(ctx: OrgCtx, env: Bindings, fileId: string) {
  const content = await contentOf(ctx, env, fileId);
  if (!content) throw notFound('File');
  if (content.row.contentType !== 'text/csv') {
    throw unprocessable('Only CSV files can be imported. Save the spreadsheet as CSV.', {
      fileId: ['Not CSV'],
    });
  }
  const [headers = [], ...rows] = parseCsv(content.text);
  return { headers: headers.map((h) => h.trim()), rows };
}

function toImport(row: repo.ImportRow, sampleRows: string[][]): Import {
  return {
    id: row.id,
    fileId: row.fileId,
    status: row.status,
    headers: row.headers,
    sampleRows,
    rowCount: row.rowCount,
    mapping: (row.mapping as Import['mapping']) ?? null,
    defaults: row.defaults ?? null,
    problems: row.problems ?? [],
    jobId: row.jobId,
    result: (row.result as Import['result']) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Starts an import from an uploaded CSV: its headers, how many rows, and the first five. */
export async function createImport(ctx: OrgCtx, env: Bindings, fileId: string): Promise<Import> {
  const { headers, rows } = await sheetOf(ctx, env, fileId);
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw unprocessable('The file has no header row.', { fileId: ['Empty'] });
  }
  if (new Set(headers).size !== headers.length) {
    throw unprocessable('Two columns have the same header. Rename one.', {
      fileId: ['Headers repeat'],
    });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw unprocessable(`At most ${MAX_IMPORT_ROWS} rows in one import. Split the file.`, {
      fileId: ['Too many rows'],
    });
  }
  const row = await repo.insertImport(ctx, {
    id: newId('import'),
    orgId: ctx.orgId,
    fileId,
    status: 'mapping',
    headers,
    rowCount: rows.length,
    createdByUserId: ctx.actorUserId,
  });
  return toImport(row, rows.slice(0, 5));
}

/** The import, for whoever started it and the owner; anyone else gets 404, as for jobs. */
async function ownImport(ctx: OrgCtx, access: Access, id: string) {
  const row = await repo.findImport(ctx, id);
  if (!row || (access.role !== 'owner' && row.createdByUserId !== ctx.actorUserId)) {
    throw notFound('Import');
  }
  return row;
}

export async function getImport(ctx: OrgCtx, env: Bindings, access: Access, id: string) {
  const row = await ownImport(ctx, access, id);
  const sheet = await sheetOf(ctx, env, row.fileId).catch(() => ({ rows: [] as string[][] }));
  return toImport(row, sheet.rows.slice(0, 5));
}

type Lookups = {
  org: Org;
  branchByName: Map<string, string>;
  branchIds: Set<string>;
  gradeByName: Map<string, string>;
  hasYear: boolean;
};

async function lookups(ctx: OrgCtx): Promise<Lookups> {
  const [org, branchList, grades, years] = await Promise.all([
    orgs.getOrg(ctx),
    branches.listBranches(ctx, 200),
    curriculum.listGradeLevels(ctx),
    calendar.academicYears(ctx),
  ]);
  return {
    org,
    branchByName: new Map(branchList.data.map((b) => [normaliseName(b.name), b.id])),
    branchIds: new Set(branchList.data.map((b) => b.id)),
    gradeByName: new Map(grades.data.map((g) => [normaliseName(g.name), g.id])),
    hasYear: years.current !== null,
  };
}

/** A date as the sheet has it: `YYYY-MM-DD`, or day/month/year in the org's date format. */
function parseDate(value: string, org: Org): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [day, month] = org.dateFormat === 'MM/DD/YYYY' ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  const iso = `${m[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Every row checked and resolved: what it adds, or the problems that stop it. Row numbers count
 * the header as row 1, as a spreadsheet shows them.
 */
function resolveRows(
  rows: string[][],
  headers: string[],
  mapping: Record<string, ImportField>,
  defaults: { branchId?: string },
  found: Lookups,
  allowedBranches: string[] | null,
) {
  const column = new Map<ImportField, number>();
  for (const [header, field] of Object.entries(mapping)) column.set(field, headers.indexOf(header));
  const problems: { row: number; field: string; message: string }[] = [];
  const resolved: people.ImportedRow[] = [];
  rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const value = (field: ImportField) => {
      const at = column.get(field);
      return at === undefined || at < 0 ? '' : (cells[at] ?? '').trim();
    };
    const problem = (field: string, message: string) =>
      problems.push({ row: rowNumber, field, message });
    const firstName = value('studentFirstName');
    const lastName = value('studentLastName');
    if (!firstName) problem('studentFirstName', 'Required');
    if (!lastName) problem('studentLastName', 'Required');
    const branchName = value('branch');
    const branchId = branchName
      ? found.branchByName.get(normaliseName(branchName))
      : defaults.branchId;
    if (branchName && !branchId) problem('branch', `No branch called “${branchName}”`);
    if (!branchName && !branchId) problem('branch', 'Required: map a column or give a default');
    if (branchId && allowedBranches && !allowedBranches.includes(branchId)) {
      problem('branch', 'Not one of your branches');
    }
    const dobText = value('dateOfBirth');
    const dateOfBirth = dobText ? parseDate(dobText, found.org) : null;
    if (dobText && !dateOfBirth) problem('dateOfBirth', `Not a date: “${dobText}”`);
    const gradeName = value('grade');
    const gradeLevelId = gradeName
      ? (found.gradeByName.get(normaliseName(gradeName)) ?? null)
      : null;
    if (gradeName && !gradeLevelId) problem('grade', `No grade level called “${gradeName}”`);
    if (gradeName && !found.hasYear) problem('grade', 'Add an academic year first');
    const email = value('guardianEmail').toLowerCase();
    if (email && !EMAIL.test(email)) problem('guardianEmail', `Not an email: “${email}”`);
    const phone = value('guardianPhone');
    if (phone && !/^[0-9+() .-]{3,30}$/.test(phone))
      problem('guardianPhone', `Not a phone number: “${phone}”`);
    const guardianFirst = value('guardianFirstName');
    const guardianLast = value('guardianLastName') || lastName;
    const hasGuardian = Boolean(guardianFirst || email || phone);
    if (hasGuardian && !guardianFirst)
      problem('guardianFirstName', 'Required with a guardian’s email or phone');
    const familyName = value('familyName') || guardianLast || lastName;
    resolved.push({
      familyName,
      branchId: branchId ?? '',
      address: value('address') || null,
      guardian: hasGuardian
        ? {
            firstName: guardianFirst,
            lastName: guardianLast,
            email: email || null,
            phone: phone || null,
            relationship: value('guardianRelationship') || null,
          }
        : null,
      student: { firstName, lastName, dateOfBirth, notes: value('notes') || null },
      gradeLevelId,
    });
  });
  return { problems, resolved };
}

/**
 * Sets the mapping and checks every row against it. The import is `ready` when no row has a
 * problem. Each field once, and the student's names mapped (400).
 */
export async function mapImport(
  ctx: OrgCtx,
  env: Bindings,
  access: Access,
  id: string,
  input: MapImport,
): Promise<Import> {
  const before = await ownImport(ctx, access, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  if (before.status !== 'mapping' && before.status !== 'ready') {
    throw unprocessable(`This import is ${before.status}.`, { status: [before.status] });
  }
  const fields: Record<string, string[]> = {};
  const used = Object.values(input.mapping);
  for (const header of Object.keys(input.mapping)) {
    if (!before.headers.includes(header)) fields[`mapping.${header}`] = ['No such column'];
  }
  for (const field of IMPORT_FIELDS) {
    if (used.filter((f) => f === field).length > 1) fields.mapping = [`${field} is mapped twice`];
  }
  for (const required of ['studentFirstName', 'studentLastName'] as const) {
    if (!used.includes(required)) (fields.mapping ??= []).push(`Map a column to ${required}`);
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const [sheet, found] = await Promise.all([sheetOf(ctx, env, before.fileId), lookups(ctx)]);
  if (input.defaults.branchId && !found.branchIds.has(input.defaults.branchId)) {
    throw notFound('Branch');
  }
  const allowed = access.scope === 'branch' ? access.branchIds : null;
  const { problems } = resolveRows(
    sheet.rows,
    sheet.headers,
    input.mapping,
    input.defaults,
    found,
    allowed,
  );
  const updated = await repo.updateImport(ctx, id, {
    mapping: input.mapping,
    defaults: input.defaults,
    problems: problems.slice(0, MAX_PROBLEMS),
    status: problems.length === 0 ? 'ready' : 'mapping',
  });
  if (!updated) throw notFound('Import');
  return toImport(updated, sheet.rows.slice(0, 5));
}

/** Commits a ready import as a job. Returns the job's id. */
export async function commitImport(
  ctx: OrgCtx,
  access: Access,
  queue: Queue<JobMessage>,
  id: string,
): Promise<string> {
  const before = await ownImport(ctx, access, id);
  if (before.status !== 'ready') {
    throw unprocessable(
      before.status === 'mapping'
        ? 'Fix the problems the check found first.'
        : `This import is ${before.status}.`,
      { status: [before.status] },
    );
  }
  const claimed = await repo.updateImport(ctx, id, { status: 'committing' }, ['ready']);
  if (!claimed) throw conflict('This import is being committed already.');
  const jobId = await startJob(ctx, queue, IMPORT_COMMIT, {
    importId: id,
    branchIds: access.scope === 'branch' ? access.branchIds : null,
  });
  await repo.updateImport(ctx, id, { jobId });
  return jobId;
}

/**
 * The job behind a commit: reads the sheet again, checks every row as the mapping did, and adds
 * them all in one batch, or nothing. A redelivered job finds the import done and returns what it
 * made, so it runs once.
 */
export async function commitImportJob(ctx: JobContext) {
  const input = ctx.input as { importId: string; branchIds: string[] | null };
  const row = await repo.findImport(ctx, input.importId);
  if (!row) throw new Error(`Import ${input.importId} not found`);
  if (row.status === 'done') return row.result;
  if (row.status !== 'committing') return { notCommitted: row.status };
  const [sheet, found] = await Promise.all([sheetOf(ctx, ctx.env, row.fileId), lookups(ctx)]);
  const { problems, resolved } = resolveRows(
    sheet.rows,
    sheet.headers,
    (row.mapping ?? {}) as Record<string, ImportField>,
    row.defaults ?? {},
    found,
    input.branchIds,
  );
  if (problems.length > 0) {
    await repo.updateImport(ctx, row.id, {
      status: 'mapping',
      problems: problems.slice(0, MAX_PROBLEMS),
    });
    throw new Error('The sheet changed since it was checked: map it again.');
  }
  await ctx.setProgress(30);
  const result = await people.importRows(ctx, resolved, row.id);
  await repo.updateImport(ctx, row.id, { status: 'done', result });
  return result;
}
