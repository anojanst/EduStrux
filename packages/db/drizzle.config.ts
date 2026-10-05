import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations only. Wrangler applies them (`wrangler d1 migrations apply`),
// reading this same folder via `migrations_dir` in apps/api/wrangler.jsonc.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
});
