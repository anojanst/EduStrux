import type { D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/env';

declare global {
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
