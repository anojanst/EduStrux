import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Drizzle Studio on the local D1 database (`pnpm db:studio`). Wrangler keeps it as a SQLite
// file under apps/api/.wrangler, named by a hash; the other .sqlite there is its metadata.
// Relative to packages/db, where pnpm runs the script (drizzle-kit loads this as CommonJS,
// so import.meta.dirname isn't set).
const dir = resolve('../../apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const file = existsSync(dir)
  ? readdirSync(dir).find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  : undefined;
if (!file) throw new Error(`No local D1 database in ${dir}. Run \`pnpm db:migrate\` first.`);

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  dbCredentials: { url: `file:${join(dir, file)}` },
});
