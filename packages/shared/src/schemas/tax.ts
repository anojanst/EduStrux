import { percentToMilli } from '../tax';
import { z } from '../zod';
import { Timestamp } from './common';

const Name = z.string().trim().min(1).max(120);

/** A decimal string, never a JSON number, so the rate stays exact. */
export const TaxPercent = z
  .string()
  .refine((p) => percentToMilli(p) !== null, 'A percentage from 0 to 100 with up to 3 decimals')
  .openapi({ example: '15', description: 'Percentage as a decimal string, e.g. "15" or "8.875".' });

export const TaxRate = z
  .object({
    id: z.string().openapi({ example: 'txr_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    percent: z.string().openapi({ example: '15' }),
    inclusive: z.boolean().openapi({ description: 'true = prices already include this tax.' }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('TaxRate');
export type TaxRate = z.infer<typeof TaxRate>;

export const CreateTaxRate = z
  .object({
    name: Name.openapi({ example: 'GST' }),
    percent: TaxPercent,
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
    percent: TaxPercent,
    inclusive: z.boolean(),
  })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateTaxRate');
export type UpdateTaxRate = z.infer<typeof UpdateTaxRate>;
