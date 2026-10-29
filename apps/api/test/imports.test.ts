import { memberships } from '@edustrux/db';
import { addDays, localNow, newId, type Role } from '@edustrux/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import { call, db, newOrg, newUser } from './helpers';

// Spreadsheet import with manual column mapping (TUI-60).

type Row = { id: string; updatedAt: string };
type As = (method: string, path: string, body?: unknown) => ReturnType<typeof call>;

const SHEET = [
  'First,Surname,Born,Year,Parent first,Parent email,Phone,Campus',
  'Aroha,Perera,17/05/2012,Year 10,Mere,mere@example.com,021 555 0100,Main',
  'Sam,Perera,2014-02-03,,Mere,MERE@example.com,,Main',
  '"Ari, Jr",Ngata,,Year 10,Ana,ana@example.com,,Albany',
].join('\n');
const MAPPING = {
  First: 'studentFirstName',
  Surname: 'studentLastName',
  // Born stays unmapped: a date of birth is no longer kept (D-171).
  Year: 'grade',
  'Parent first': 'guardianFirstName',
  'Parent email': 'guardianEmail',
  Phone: 'guardianPhone',
  Campus: 'branch',
};

async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const base = `/api/v1/orgs/${org.id}`;
  const api: As = (method, path, body) =>
    call(method, `${base}${path}`, { token: owner.token, body });
  const make = async <T = Row>(path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const member = async (role: Role, branchIds: string[] | null = null) => {
    const user = await newUser(role);
    await db()
      .insert(memberships)
      .values({ id: newId('membership'), orgId: org.id, userId: user.userId, role, branchIds });
    const as: As = (method, path, body) =>
      call(method, `${base}${path}`, { token: user.token, body });
    return { as };
  };
  const today = localNow('Pacific/Auckland').date;
  await make('/academic-years', {
    name: 'This year',
    startDate: addDays(today, -100),
    endDate: addDays(today, 100),
  });
  const y10 = await make('/grade-levels', { name: 'Year 10' });
  const albany = await make('/branches', { name: 'Albany' });
  const main = (await api('GET', '/branches')).body.data[0] as Row;
  /** Uploads the CSV and starts an import of it. */
  const upload = async (csv: string, as: As = api) => {
    const link = (
      await as('POST', '/files/upload-url', {
        filename: 'students.csv',
        contentType: 'text/csv',
        size: new TextEncoder().encode(csv).byteLength,
      })
    ).body;
    await exports.default.fetch(new Request(link.uploadUrl, { method: 'PUT', body: csv }));
    return as('POST', '/imports', { fileId: link.file.id });
  };
  const finished = async (jobId: string, as: As = api) => {
    for (let i = 0; i < 400; i++) {
      const job = (await as('GET', `/jobs/${jobId}`)).body;
      if (job.status === 'succeeded' || job.status === 'failed') return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('job did not finish');
  };
  return { api, member, main, albany, y10, upload, finished };
}

describe('parseCsv', () => {
  it('reads quotes, commas and newlines in fields, CRLF, a BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['two\nlines', 'z'],
    ]);
  });
});

describe('imports', () => {
  it('reads the headers, maps and checks the rows, and adds families and students', async () => {
    const { api, upload, finished, y10, main, albany } = await setup();
    const started = await upload(SHEET);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      status: 'mapping',
      headers: [
        'First',
        'Surname',
        'Born',
        'Year',
        'Parent first',
        'Parent email',
        'Phone',
        'Campus',
      ],
      rowCount: 3,
      sampleRows: [
        expect.any(Array),
        expect.any(Array),
        ['Ari, Jr', 'Ngata', '', 'Year 10', 'Ana', 'ana@example.com', '', 'Albany'],
      ],
      mapping: null,
      problems: [],
    });
    const mapped = await api('PATCH', `/imports/${started.body.id}`, {
      updatedAt: started.body.updatedAt,
      mapping: MAPPING,
    });
    expect(mapped.status).toBe(200);
    expect(mapped.body).toMatchObject({ status: 'ready', problems: [] });

    const committed = await api('POST', `/imports/${started.body.id}/commit`);
    expect(committed.status).toBe(202);
    const job = await finished(committed.body.jobId);
    expect(job).toMatchObject({
      status: 'succeeded',
      result: { families: 2, guardians: 2, students: 3 },
    });
    const families = (await api('GET', '/families')).body.data as {
      name: string;
      branchId: string;
      billingGuardianId: string;
      guardians: { firstName: string; lastName: string; email: string; phone: string | null }[];
      students: { firstName: string; gradeLevelId: string | null }[];
    }[];
    const perera = families.find((f) => f.name === 'Perera')!;
    expect(perera.branchId).toBe(main.id);
    expect(perera.guardians).toEqual([
      expect.objectContaining({
        firstName: 'Mere',
        lastName: 'Perera',
        email: 'mere@example.com',
        phone: '021 555 0100',
      }),
    ]);
    expect(perera.billingGuardianId).toEqual(expect.stringMatching(/^gdn_/));
    expect(perera.students.map((s) => [s.firstName, s.gradeLevelId])).toEqual([
      ['Aroha', y10.id],
      ['Sam', null],
    ]);
    const ngata = families.find((f) => f.name === 'Ngata')!;
    expect(ngata.branchId).toBe(albany.id);
    expect(ngata.students[0]!.firstName).toBe('Ari, Jr');
    const audit = (await api('GET', '/audit-log?limit=5')).body.data.map(
      (a: { action: string }) => a.action,
    );
    expect(audit).toContain('import.committed');

    // Done: committing again is refused.
    expect((await api('POST', `/imports/${started.body.id}/commit`)).status).toBe(422);
  });

  it('lists each row’s problems, and won’t commit until there are none', async () => {
    const { api, upload } = await setup();
    const sheet = [
      'First,Surname,Born,Year,Parent email,Campus',
      ',Perera,32/13/2012,Year 12,not-an-email,Nowhere',
      'Ben,Smith,,,,',
    ].join('\n');
    const started = (await upload(sheet)).body;
    const mapped = await api('PATCH', `/imports/${started.id}`, {
      updatedAt: started.updatedAt,
      mapping: {
        First: 'studentFirstName',
        Surname: 'studentLastName',
        Year: 'grade',
        'Parent email': 'guardianEmail',
        Campus: 'branch',
      },
    });
    expect(mapped.body.status).toBe('mapping');
    expect(mapped.body.problems).toEqual([
      { row: 2, field: 'studentFirstName', message: 'Required' },
      { row: 2, field: 'branch', message: 'No branch called “Nowhere”' },
      { row: 2, field: 'grade', message: 'No grade level called “Year 12”' },
      { row: 2, field: 'guardianEmail', message: 'Not an email: “not-an-email”' },
      { row: 2, field: 'guardianFirstName', message: 'Required with a guardian’s email or phone' },
      { row: 3, field: 'branch', message: 'Required: map a column or give a default' },
    ]);
    expect((await api('POST', `/imports/${started.id}/commit`)).status).toBe(422);
  });

  it('refuses a bad mapping or file', async () => {
    const { api, upload } = await setup();
    const started = (await upload(SHEET)).body;
    const patch = (mapping: Record<string, string>) =>
      api('PATCH', `/imports/${started.id}`, { updatedAt: started.updatedAt, mapping });
    expect((await patch({ First: 'studentFirstName' })).status).toBe(400);
    expect((await patch({ ...MAPPING, Nope: 'notes' })).body.error.fields).toHaveProperty([
      'mapping.Nope',
    ]);
    expect((await patch({ ...MAPPING, Phone: 'studentFirstName' })).status).toBe(400);
    expect((await patch({ ...MAPPING, Phone: 'favouriteColour' })).status).toBe(400);
    expect((await patch({ ...MAPPING, Born: 'dateOfBirth' })).status).toBe(400);
    const stale = await api('PATCH', `/imports/${started.id}`, {
      updatedAt: '2020-01-01T00:00:00.000Z',
      mapping: MAPPING,
    });
    expect(stale.status).toBe(409);
    expect((await upload('a,a\n1,2')).status).toBe(422);
    expect((await api('POST', '/imports', { fileId: 'fil_missing' })).status).toBe(404);
  });

  it('keeps branch staff to their branches, and imports to whoever started them', async () => {
    const { upload, member, albany, api } = await setup();
    const desk = await member('front_desk', [albany.id]);
    const started = (await upload(SHEET, desk.as)).body;
    const mapped = await desk.as('PATCH', `/imports/${started.id}`, {
      updatedAt: started.updatedAt,
      mapping: MAPPING,
    });
    expect(mapped.body.problems).toEqual([
      { row: 2, field: 'branch', message: 'Not one of your branches' },
      { row: 3, field: 'branch', message: 'Not one of your branches' },
    ]);
    expect((await api('GET', `/imports/${started.id}`)).status).toBe(200);
    const other = await member('branch_manager');
    expect((await other.as('GET', `/imports/${started.id}`)).status).toBe(404);
    expect((await (await member('teacher')).as('POST', '/imports', { fileId: 'x' })).status).toBe(
      403,
    );
  });
});
