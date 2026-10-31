import { createApp } from './app';
import type { EmailMessage, JobMessage } from './background/messages';
import { handleQueue } from './background/queue';
import { handleScheduled } from './background/scheduled';
import type { Bindings } from './env';
import { serveHome } from './site';

const app = createApp();

export default {
  // "/" is the marketing page or the app's page (TUI-76); everything else is the API.
  fetch: (request, env, ctx) => serveHome(request, env) ?? app.fetch(request, env, ctx),
  queue: handleQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Bindings, EmailMessage | JobMessage>;
