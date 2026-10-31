import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // A build is what the Worker serves in production (`pnpm deploy:production`). Without the key
  // it would only show the "setup needed" page, so stop the build (and the deploy) instead.
  if (
    command === 'build' &&
    !loadEnv(mode, import.meta.dirname, 'VITE_').VITE_CLERK_PUBLISHABLE_KEY
  ) {
    throw new Error(
      'Set VITE_CLERK_PUBLISHABLE_KEY to the publishable key of the Clerk instance whose secret key the Worker uses (README, Deploying)',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    // The app, and the marketing page the Worker serves at edustrux.com (TUI-76).
    build: {
      rollupOptions: {
        input: {
          app: resolve(import.meta.dirname, 'index.html'),
          landing: resolve(import.meta.dirname, 'landing.html'),
        },
      },
    },
    server: {
      port: Number(process.env.PORT) || 5173,
      // The API runs on :8787 (`pnpm dev`); same origin in the browser, as in production.
      proxy: { '/api': 'http://localhost:8787' },
    },
  };
});
