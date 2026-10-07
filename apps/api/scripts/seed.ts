// Creates test users in your Clerk *development* instance and matching orgs and memberships
// in the local D1 database, so you can call the API as each role from Swagger.
//
//   pnpm seed
//
// Safe to re-run: existing Clerk users and rows are reused.

import type { Role } from '@edustrux/shared';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DIR, devClerk, SEED_FILE, type SeedFile } from './lib';

const ORGS = {
  a: {
    id: 'org_seed_bright_minds',
    name: 'Bright Minds Tuition',
    slug: 'bright-minds',
    country: 'NZ',
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    locale: 'en-NZ',
    dateFormat: 'DD/MM/YYYY',
  },
  // A second org, to check that org A's users can't see it.
  b: {
    id: 'org_seed_harmony_music',
    name: 'Harmony Music School',
    slug: 'harmony-music',
    country: 'GB',
    currency: 'GBP',
    timezone: 'Europe/London',
    locale: 'en-GB',
    dateFormat: 'DD/MM/YYYY',
  },
} as const;

// `+clerk_test` addresses never receive real email; Clerk accepts code 424242 for them.
const USERS: { key: string; role: Role; org: keyof typeof ORGS; first: string; last: string }[] = [
  { key: 'owner', role: 'owner', org: 'a', first: 'Olivia', last: 'Owner' },
  { key: 'branch_manager', role: 'branch_manager', org: 'a', first: 'Ben', last: 'Manager' },
  { key: 'front_desk', role: 'front_desk', org: 'a', first: 'Fiona', last: 'Desk' },
  { key: 'teacher', role: 'teacher', org: 'a', first: 'Tom', last: 'Teacher' },
  { key: 'parent', role: 'parent', org: 'a', first: 'Priya', last: 'Parent' },
  { key: 'accountant', role: 'accountant', org: 'a', first: 'Alex', last: 'Accounts' },
  { key: 'owner_b', role: 'owner', org: 'b', first: 'Harper', last: 'Owner' },
];

const emailFor = (key: string) => `seed.${key.replace('_', '.')}+clerk_test@example.com`;
const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);

async function main() {
  const clerk = devClerk();
  const now = new Date().toISOString();
  const trialEnds = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const seeded: SeedFile = {};
  const sql: string[] = [];

  for (const org of Object.values(ORGS)) {
    sql.push(
      `INSERT OR IGNORE INTO orgs (id, name, slug, country, currency, timezone, locale, date_format, single_tutor_mode, plan, status, trial_ends_at, created_at, updated_at)
       VALUES (${q(org.id)}, ${q(org.name)}, ${q(org.slug)}, ${q(org.country)}, ${q(org.currency)}, ${q(org.timezone)}, ${q(org.locale)}, ${q(org.dateFormat)}, 0, 'trial', 'trialing', ${q(trialEnds)}, ${q(now)}, ${q(now)});`,
      // Every org has a branch from creation. Same id as migration 0003's backfill would give it.
      `INSERT OR IGNORE INTO branches (id, org_id, name, address, created_at, updated_at)
       VALUES (${q(org.id.replace(/^org_/, 'brn_'))}, ${q(org.id)}, 'Main', NULL, ${q(now)}, ${q(now)});`,
    );
  }

  for (const u of USERS) {
    const email = emailFor(u.key);
    const existing = await clerk.users.getUserList({ emailAddress: [email] });
    const clerkUser =
      existing.data.find((x) => x.emailAddresses.some((e) => e.emailAddress === email)) ??
      (await clerk.users.createUser({
        emailAddress: [email],
        firstName: u.first,
        lastName: u.last,
        skipPasswordRequirement: true,
      }));
    const org = ORGS[u.org];
    console.log(`  ${existing.data.length ? '·' : '+'} ${u.key.padEnd(15)} ${email}`);

    const userId = `usr_seed_${u.key}`;
    sql.push(
      `INSERT OR IGNORE INTO users (id, clerk_user_id, email, name, created_at, updated_at)
       VALUES (${q(userId)}, ${q(clerkUser.id)}, ${q(email)}, ${q(`${u.first} ${u.last}`)}, ${q(now)}, ${q(now)});`,
      // Look the user up by Clerk id, in case they signed in before seeding and got a random id.
      `INSERT OR IGNORE INTO memberships (id, org_id, user_id, role, branch_ids, status, created_at, updated_at)
       SELECT ${q(`mem_seed_${u.key}`)}, ${q(org.id)}, id, ${q(u.role)}, NULL, 'active', ${q(now)}, ${q(now)}
       FROM users WHERE clerk_user_id = ${q(clerkUser.id)};`,
    );

    seeded[u.key] = {
      clerkUserId: clerkUser.id,
      email,
      role: u.role,
      orgId: org.id,
      orgName: org.name,
    };
  }

  const run = (args: string[]) =>
    execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: API_DIR,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, CI: 'true' },
    });

  console.log('\nApplying migrations to local D1…');
  run(['d1', 'migrations', 'apply', 'DB', '--local']);

  const sqlDir = join(API_DIR, '.wrangler', 'tmp');
  mkdirSync(sqlDir, { recursive: true });
  const sqlFile = join(sqlDir, 'seed.sql');
  writeFileSync(sqlFile, sql.join('\n'));
  console.log('Writing seed rows…');
  run(['d1', 'execute', 'DB', '--local', '--file', sqlFile]);

  writeFileSync(SEED_FILE, JSON.stringify(seeded, null, 2));
  console.log(`\n✔ Seeded ${USERS.length} users in 2 orgs. Next: pnpm dev:token owner\n`);
}

await main();
