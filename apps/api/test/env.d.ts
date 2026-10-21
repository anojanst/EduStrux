import type { D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/env';

declare global {
  // Vite's file glob, which the test runner provides: the sources as text, for checks on the
  // code itself (TUI-82).
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, unknown>;
  }

  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
      TEST_JWT_PRIVATE_KEY: string;
    }
    // Types `exports.default` from 'cloudflare:workers' as our worker.
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
  }
}
