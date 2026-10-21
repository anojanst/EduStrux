import { generateKeyPairSync } from 'node:crypto';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests sign their own Clerk-shaped tokens with a throwaway key pair. The API verifies
// them through the same code path as production (CLERK_JWT_KEY), with no calls to Clerk.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ENVIRONMENT: 'test',
          // Never send real email from tests, even when .dev.vars has a key for local work.
          RESEND_API_KEY: '',
          EMAIL_FROM: '',
          CLERK_JWT_KEY: publicKey,
          TEST_JWT_PRIVATE_KEY: privateKey,
          TEST_MIGRATIONS: await readD1Migrations('../../packages/db/migrations'),
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    // A test makes many requests against a real local D1. The slowest take about 3.5s on a
    // laptop and more than vitest's 5s default on a GitHub runner, which failed the deploy.
    testTimeout: 30_000,
  },
}));
