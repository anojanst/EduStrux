import { absenceNotices, auditLog } from '@edustrux/db';
import { newId } from '@edustrux/shared';
import { env } from 'cloudflare:workers';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, db, newOrg, newUser } from './helpers';

// The least-data rule (D-171): six personal fields are gone (TUI-115), and the audit log keeps
// that a personal field changed, not its value (TUI-116).

const DROPPED = ['address', 'relationship', 'language', 'dateOfBirth', 'notes'];

describe('the dropped fields', () => {
  it('are in none of the people schemas in /api/openapi.json', async () => {
    const spec = (await call('GET', '/api/openapi.json')).body as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    const people = [
      'Family',
      'CreateFamily',
      'UpdateFamily',
      'Guardian',
      'CreateGuardian',
      'UpdateGuardian',
      'Student',
      'CreateStudent',
      'UpdateStudent',
      'PortalChild',
      'SearchStudent',
      'SearchGuardian',
    ];
    for (const name of people) {
      const properties = Object.keys(spec.components.schemas[name]?.properties ?? {});
      expect(properties.length, name).toBeGreaterThan(0);
      expect(
        properties.filter((p) => DROPPED.includes(p)),
        name,
      ).toEqual([]);
    }
    const reason = spec.components.schemas.CreateAbsenceNotice?.properties?.reason as {
      enum: (string | null)[];
    };
    expect(reason.enum).toEqual(expect.arrayContaining(['sick', 'holiday', 'other']));
    expect(reason.enum.filter((v) => v !== null)).toHaveLength(3);
  });
});

describe('migration 0037', () => {
  /** Runs the data migration again, over rows written as they were before it. */
  async function scrub() {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0037_'));
    if (!migration) throw new Error('Migration 0037 missing');
    for (const query of migration.queries) await env.DB.prepare(query).run();
  }

  it('scrubs the personal values already in the audit log, and maps old absence reasons', async () => {
    const owner = await newUser('owner');
    const org = await newOrg(owner.token);
    const row = (action: string, before: unknown, after: unknown) => ({
      id: newId('audit'),
      orgId: org.id,
      actorUserId: null,
      action,
      entityType: action.split('.')[0]!,
      entityId: 'x',
      before,
      after,
    });
    const rows = [
      row(
        'guardian.updated',
        { email: 'mere@example.com', phone: null, emergencyContact: true },
        { email: 'mere.perera@example.com', phone: '021 555 0100', emergencyContact: false },
      ),
      row('student.created', null, {
        id: 'stu_1',
        firstName: 'Aroha',
        dateOfBirth: '2012-05-17',
        notes: 'Asthma inhaler',
      }),
      row('family.updated', { address: '4 Kowhai Street' }, { address: null }),
      row(
        'lesson_notes.updated',
        { homework: null, notes: [{ studentId: 'stu_1', note: null }] },
        { homework: 'Read chapter 3', notes: [{ studentId: 'stu_1', note: 'Worried about home' }] },
      ),
      row('enrolment_request.received', null, {
        status: 'pending',
        guardian: { firstName: 'Mere', email: 'mere@example.com' },
        students: [{ firstName: 'Aroha' }],
      }),
      row('class.updated', { name: 'Maths' }, { name: 'Algebra' }),
    ];
    await db().insert(auditLog).values(rows);
    const notice = {
      id: newId('absenceNotice'),
      orgId: org.id,
      studentId: 'stu_1',
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      source: 'parent' as const,
    };
    await env.DB.prepare(
      'insert into absence_notices (id, org_id, student_id, start_date, end_date, reason, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        notice.id,
        notice.orgId,
        notice.studentId,
        notice.startDate,
        notice.endDate,
        'Hospital appointment',
        notice.source,
        '2026-10-29T00:00:00.000Z',
        '2026-10-29T00:00:00.000Z',
      )
      .run();

    await scrub();
    // Running it twice changes nothing more.
    await scrub();

    const stored = await db()
      .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(
        inArray(
          auditLog.id,
          rows.map((r) => r.id),
        ),
      );
    const of = (action: string) => stored.find((r) => r.action === action)!;
    expect(of('guardian.updated')).toMatchObject({
      before: { email: 'changed', phone: null, emergencyContact: true },
      after: { email: 'changed', phone: 'changed', emergencyContact: false },
    });
    expect(of('student.created').after).toEqual({
      id: 'stu_1',
      firstName: 'changed',
      dateOfBirth: 'changed',
      notes: 'changed',
    });
    expect(of('family.updated')).toMatchObject({
      before: { address: 'changed' },
      after: { address: null },
    });
    expect(of('lesson_notes.updated')).toMatchObject({
      before: { homework: null, notes: [{ studentId: 'stu_1', note: null }] },
      after: { homework: 'Read chapter 3', notes: [{ studentId: 'stu_1', note: 'changed' }] },
    });
    expect(of('enrolment_request.received').after).toEqual({
      status: 'pending',
      guardian: 'changed',
      students: 'changed',
    });
    // Not people: left as it was.
    expect(of('class.updated')).toMatchObject({
      before: { name: 'Maths' },
      after: { name: 'Algebra' },
    });

    const [mapped] = await db()
      .select({ reason: absenceNotices.reason })
      .from(absenceNotices)
      .where(eq(absenceNotices.id, notice.id));
    expect(mapped?.reason).toBe('other');
  });
});
