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

/** A 400 the schema can't catch, e.g. a PATCH whose new end date is before the stored start. */
export const validationFailed = (fields: FieldErrors) =>
  new ApiError(400, 'validation_failed', 'Request validation failed', fields);

export const unprocessable = (message: string, fields?: FieldErrors) =>
  new ApiError(422, 'unprocessable', message, fields);

/** A service the request needs isn't set up, or isn't answering: PDFs without Browser Rendering. */
export const unavailable = (message: string) => new ApiError(503, 'unavailable', message);

/** The org's plan holds no more of something: active students (TUI-74). */
export const planLimit = (message: string, fields?: FieldErrors) =>
  new ApiError(402, 'plan_limit', message, fields);

/** The trial has ended with no subscription, or the org is suspended or cancelled (TUI-74). */
export const subscriptionRequired = () =>
  new ApiError(
    402,
    'subscription_required',
    'This organisation is read-only until it has a subscription. The owner can subscribe under Billing.',
  );
