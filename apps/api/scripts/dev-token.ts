// Prints a Clerk session token for a seeded user, to paste into Swagger's Authorize box.
//
//   pnpm dev:token                  # owner of Bright Minds Tuition
//   pnpm dev:token teacher
//   pnpm dev:token owner_b          # owner of the second org (for isolation checks)
//   pnpm dev:token parent --hours 2
//   TOKEN=$(pnpm -s dev:token owner --raw)

import { existsSync, readFileSync } from 'node:fs';
import { devClerk, fail, SEED_FILE, type SeedFile } from './lib';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const hoursFlag = args.indexOf('--hours');
const hours = hoursFlag >= 0 ? Number(args[hoursFlag + 1]) : 8;
const key = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--hours') ?? 'owner';

if (!existsSync(SEED_FILE)) fail('No seeded users yet. Run `pnpm seed` first.');
const seeded = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedFile;
const user = seeded[key];
if (!user) fail(`Unknown user "${key}". Choose one of: ${Object.keys(seeded).join(', ')}`);
if (!Number.isFinite(hours) || hours <= 0) fail('--hours must be a positive number');

const clerk = devClerk();
// Creating sessions from the Backend API only works on development instances.
const session = await clerk.sessions.createSession({ userId: user.clerkUserId });
const template = process.env.CLERK_JWT_TEMPLATE; // optional: a JWT template that adds claims
const { jwt } = await clerk.sessions.getToken(session.id, template, Math.round(hours * 3600));

if (raw) {
  process.stdout.write(jwt);
} else {
  console.log(`
  User     ${user.email}
  Role     ${user.role} at ${user.orgName}
  Org id   ${user.orgId}
  Expires  in ${hours}h

  Paste this into Swagger → Authorize (http://localhost:8787/api/docs):

${jwt}
`);
}
