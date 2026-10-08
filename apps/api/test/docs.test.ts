import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('API docs', () => {
  it('serves an OpenAPI 3.1 spec with Bearer auth', async () => {
    const res = await call('GET', '/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.components.securitySchemes.Bearer).toMatchObject({ scheme: 'bearer' });
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/me',
        '/api/v1/orgs',
        '/api/v1/orgs/{orgId}',
        '/api/v1/orgs/{orgId}/audit-log',
        '/api/v1/orgs/{orgId}/branches',
        '/api/v1/orgs/{orgId}/branches/{branchId}',
        '/api/v1/orgs/{orgId}/branches/{branchId}/rooms',
        '/api/v1/orgs/{orgId}/rooms/{roomId}',
        '/api/v1/orgs/{orgId}/grade-levels',
        '/api/v1/orgs/{orgId}/grade-levels/order',
        '/api/v1/orgs/{orgId}/grade-levels/{gradeLevelId}',
        '/api/v1/orgs/{orgId}/subjects',
        '/api/v1/orgs/{orgId}/subjects/{subjectId}',
        '/api/v1/orgs/{orgId}/academic-years',
        '/api/v1/orgs/{orgId}/academic-years/{academicYearId}',
        '/api/v1/orgs/{orgId}/terms',
        '/api/v1/orgs/{orgId}/terms/{termId}',
        '/api/v1/orgs/{orgId}/holidays',
        '/api/v1/orgs/{orgId}/holidays/{holidayId}',
        '/api/v1/orgs/{orgId}/tax-rates',
        '/api/v1/orgs/{orgId}/tax-rates/{taxRateId}',
      ]),
    );
    expect(res.body.paths['/api/v1/health'].get.security).toEqual([]);
  });

  it('serves Swagger UI', async () => {
    const res = await fetchText('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});

async function fetchText(path: string) {
  const { exports } = await import('cloudflare:workers');
  const res = await exports.default.fetch(new Request(`http://api.test${path}`));
  return { status: res.status, text: await res.text() };
}
