import { OpenAPIHono, type z } from '@hono/zod-openapi';
import { ErrorResponse } from '@edustrux/shared';
import type { AppEnv } from '../env';
import { errorBody } from './errors';

type ZodIssues = z.core.$ZodIssue[];

export function fieldErrors(issues: ZodIssues) {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/** Every module router is created here so validation errors use the shared error format. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            'validation_failed',
            'Request validation failed',
            fieldErrors(result.error.issues),
          ),
          400,
        );
      }
    },
  });
}

/** Response entry for an OpenAPI route. */
export function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

/** Request body entry. `required: true` makes a missing or non-JSON body a 400. */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return { required: true, content: { 'application/json': { schema } } };
}

const ERROR_DESCRIPTIONS = {
  400: 'Validation failed',
  401: 'Missing, invalid or expired session token',
  403: 'Your role does not allow this',
  404: 'Not found. Also returned for orgs you are not a member of, so org ids are never confirmed.',
  409: 'Conflict, stale `updatedAt`, or a request with this Idempotency-Key still in progress',
  422: 'Business rule failed, or an Idempotency-Key was reused with a different request',
  429: 'Rate limited. See Retry-After.',
} as const;

export function errors(...codes: (keyof typeof ERROR_DESCRIPTIONS)[]) {
  return Object.fromEntries(
    codes.map((code) => [code, json(ErrorResponse, ERROR_DESCRIPTIONS[code])]),
  ) as Record<(typeof codes)[number], ReturnType<typeof json<typeof ErrorResponse>>>;
}
