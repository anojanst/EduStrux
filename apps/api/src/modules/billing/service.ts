import { newId, type CreateTaxRate, type TaxRate, type UpdateTaxRate } from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData } from '../../lib/errors';
import { decodeCursor, toPage } from '../../lib/pagination';
import * as repo from './repository';

export function toTaxRate(row: repo.TaxRateRow): TaxRate {
  const { orgId: _org, deletedAt: _deleted, ...rate } = row;
  return rate;
}

const nameTaken = () => conflict('A tax rate with that name already exists', { name: ['Taken'] });

/** An org with no tax rates charges no tax: that's a valid setup. */
export async function listTaxRates(ctx: OrgCtx, limit: number, cursor?: string) {
  const rows = await repo.listTaxRates(ctx, limit, decodeCursor(cursor));
  const { data, nextCursor } = toPage(rows, limit);
  return { data: data.map(toTaxRate), nextCursor };
}

async function findTaxRateOr404(ctx: OrgCtx, id: string) {
  const row = await repo.findTaxRate(ctx, id);
  if (!row) throw notFound('Tax rate');
  return row;
}

async function getTaxRate(ctx: OrgCtx, id: string): Promise<TaxRate> {
  return toTaxRate(await findTaxRateOr404(ctx, id));
}

export async function createTaxRate(ctx: OrgCtx, input: CreateTaxRate): Promise<TaxRate> {
  if (await repo.taxRateNameTaken(ctx, input.name)) throw nameTaken();

  const id = newId('taxRate');
  await repo.insertTaxRate(ctx, {
    id,
    orgId: ctx.orgId,
    name: input.name,
    rateBps: input.rateBps,
    inclusive: input.inclusive,
  });
  return getTaxRate(ctx, id);
}

export async function updateTaxRate(
  ctx: OrgCtx,
  id: string,
  input: UpdateTaxRate,
): Promise<TaxRate> {
  const before = await findTaxRateOr404(ctx, id);
  if (before.updatedAt !== input.updatedAt) throw staleData();
  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toTaxRate(before);

  if (changes.name !== undefined && (await repo.taxRateNameTaken(ctx, changes.name, id))) {
    throw nameTaken();
  }

  await repo.updateTaxRate(ctx, before, changes);
  return getTaxRate(ctx, id);
}

export async function deleteTaxRate(ctx: OrgCtx, id: string): Promise<void> {
  const before = await findTaxRateOr404(ctx, id);
  await repo.softDeleteTaxRate(ctx, before);
}
