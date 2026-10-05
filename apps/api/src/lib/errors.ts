import type { ErrorCode } from '@edustrux/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }
}

export function errorBody(code: ErrorCode, message: string, fields?: FieldErrors) {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

export const unauthenticated = (message = 'Sign in required') =>
  new ApiError(401, 'unauthenticated', message);

export const forbidden = (message = 'You do not have permission to do this') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);

export const conflict = (message: string, fields?: FieldErrors) =>
  new ApiError(409, 'conflict', message, fields);

export const staleData = () =>
  new ApiError(409, 'stale_data', 'This record was changed by someone else. Reload and try again.');

export const unprocessable = (message: string, fields?: FieldErrors) =>
  new ApiError(422, 'unprocessable', message, fields);
