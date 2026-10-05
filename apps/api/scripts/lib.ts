import { createClerkClient } from '@clerk/backend';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_FILE = join(API_DIR, '.seed-users.json');

/** Reads KEY=value pairs from apps/api/.dev.vars (the same file `wrangler dev` uses). */
function readDevVars(): Record<string, string> {
  const path = join(API_DIR, '.dev.vars');
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) vars[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
  return vars;
}

/** A Clerk client for the *development* instance. Refuses live keys. */
export function devClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY ?? readDevVars().CLERK_SECRET_KEY;
  if (!secretKey || secretKey.includes('replace_me')) {
    fail('Set CLERK_SECRET_KEY in apps/api/.dev.vars (copy .dev.vars.example).');
  }
  if (!secretKey.startsWith('sk_test_')) {
    fail('These scripts only run against a Clerk development instance (sk_test_ keys).');
  }
  return createClerkClient({ secretKey });
}

export type SeedUser = {
  clerkUserId: string;
  email: string;
  role: string;
  orgId: string;
  orgName: string;
};
export type SeedFile = Record<string, SeedUser>;

export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
