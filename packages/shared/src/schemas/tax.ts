import { z } from '../zod';
import { Timestamp } from './common';

const Name = z.string().trim().min(1).max(120);

/** Basis points (hundredths of a percent), an integer like money's minor units: 1500 = 15%. */
export const RateBps = z.number().int().min(0).max(10_000).openapi({
  example: 1500,
  description: 'The rate in basis points: 1500 = 15%, 1250 = 12.5%, 0 = zero-rated.',
});

export const TaxRate = z
  .object({
    id: z.string().openapi({ example: 'txr_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    rateBps: RateBps,
    inclusive: z.boolean().openapi({ description: 'true = prices already include this tax.' }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('TaxRate');
export type TaxRate = z.infer<typeof TaxRate>;

export const CreateTaxRate = z
  .object({
    name: Name.openapi({ example: 'GST' }),
    rateBps: RateBps,
    inclusive: z.boolean().openapi({ description: 'true = prices already include this tax.' }),
  })
  .openapi('CreateTaxRate');
export type CreateTaxRate = z.infer<typeof CreateTaxRate>;

export const UpdateTaxRate = z
  .object({
    updatedAt: Timestamp.openapi({
      description: 'The updatedAt you last read. A newer value on the server returns 409.',
    }),
    name: Name,
    rateBps: RateBps,
    inclusive: z.boolean(),
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateTaxRate');
export type UpdateTaxRate = z.infer<typeof UpdateTaxRate>;
