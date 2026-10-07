import type { Db } from '@edustrux/db';
import { newId, type CreateOrg, type Org, type UpdateOrg } from '@edustrux/shared';
import type { OrgCtx } from '../../db/scope';
import { conflict, notFound, staleData, unprocessable } from '../../lib/errors';
import * as branches from '../branches/service';
import * as repo from './repository';

const TRIAL_DAYS = 14;

export function toOrg(row: repo.OrgRow): Org {
  const { deletedAt: _deleted, ...org } = row;
  return org;
}

function slugify(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length >= 3 ? slug : `org-${slug}`.replace(/-$/, '');
}

async function availableSlug(db: Db, name: string) {
  const base = slugify(name);
  if (!(await repo.slugTaken(db, base))) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await repo.slugTaken(db, candidate))) return candidate;
  }
  throw conflict('Could not find a free slug. Please choose one.', { slug: ['Taken'] });
}

export async function createOrg(db: Db, userId: string, input: CreateOrg): Promise<Org> {
  let slug = input.slug;
  if (slug) {
    if (await repo.slugTaken(db, slug)) throw conflict('That slug is taken', { slug: ['Taken'] });
  } else {
    slug = await availableSlug(db, input.name);
  }

  const id = newId('org');
  await repo.insertOrgWithOwner(
    db,
    {
      id,
      name: input.name,
      slug,
      country: input.country ?? null,
      currency: input.currency,
      timezone: input.timezone,
      locale: input.locale,
      dateFormat: input.dateFormat,
      singleTutorMode: input.singleTutorMode,
      plan: 'trial',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
    },
    userId,
    branches.defaultBranch(db, id),
  );

  const created = await repo.findOrg({ db, orgId: id, actorUserId: userId });
  if (!created) throw new Error('Org missing after insert');
  return toOrg(created);
}

export async function getOrg(ctx: OrgCtx): Promise<Org> {
  const row = await repo.findOrg(ctx);
  if (!row) throw notFound('Organisation');
  return toOrg(row);
}

export async function updateOrg(ctx: OrgCtx, input: UpdateOrg): Promise<Org> {
  const before = await repo.findOrg(ctx);
  if (!before) throw notFound('Organisation');
  if (before.updatedAt !== input.updatedAt) throw staleData();

  const { updatedAt: _ignored, ...changes } = input;
  if (Object.keys(changes).length === 0) return toOrg(before);
  if (changes.singleTutorMode && !before.singleTutorMode) {
    if ((await branches.countBranches(ctx)) > 1) {
      throw unprocessable('Single-tutor mode allows one branch. Delete the other branches first.', {
        singleTutorMode: ['More than one branch'],
      });
    }
  }
  if (changes.slug && changes.slug !== before.slug) {
    if (await repo.slugTaken(ctx.db, changes.slug, ctx.orgId)) {
      throw conflict('That slug is taken', { slug: ['Taken'] });
    }
  }

  await repo.updateOrg(ctx, before, changes);
  return getOrg(ctx);
}

/** How many staff are limited to this branch (memberships with it in their branch list). */
export function countMembersLimitedToBranch(ctx: OrgCtx, branchId: string) {
  return repo.countMembersLimitedToBranch(ctx, branchId);
}
