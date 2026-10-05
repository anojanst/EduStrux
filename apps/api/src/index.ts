import { createApp } from './app';
import type { EmailMessage, JobMessage } from './background/messages';
import { handleQueue } from './background/queue';
import { handleScheduled } from './background/scheduled';
import type { Bindings } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Bindings, EmailMessage | JobMessage>;
