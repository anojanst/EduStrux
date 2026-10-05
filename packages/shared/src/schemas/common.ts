import { z } from '../zod';

export const ErrorCode = z.enum([
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'stale_data',
  'idempotency_key_reused',
  'request_in_progress',
  'unprocessable',
  'rate_limited',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string(),
      fields: z.record(z.string(), z.array(z.string())).optional(),
    }),
  })
  .openapi('Error');

/** Integer minor units + ISO 4217 currency, e.g. { amount: 2490, currency: "NZD" }. */
export const Money = z
  .object({
    amount: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .openapi('Money', { example: { amount: 2490, currency: 'NZD' } });

export const Timestamp = z.iso.datetime().openapi({ example: '2026-10-05T03:12:45.123Z' });
export const LocalDate = z.iso.date().openapi({ example: '2026-10-14' });
export const LocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ example: '16:00' });

export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code like NZD')
  .openapi({ example: 'NZD' });

export const TimeZone = z
  .string()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Must be an IANA time zone like Pacific/Auckland')
  .openapi({ example: 'Pacific/Auckland' });

export const Locale = z
  .string()
  .refine((l) => {
    try {
      return Intl.getCanonicalLocales(l).length === 1;
    } catch {
      return false;
    }
  }, 'Must be a BCP 47 locale like en-NZ')
  .openapi({ example: 'en-NZ' });

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ example: 50 }),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
