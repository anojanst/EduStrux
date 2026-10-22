import { createDb } from '@edustrux/db';
import type { Bindings } from '../env';
import { deliverEmail } from './email';
import { runJob } from './jobs';
import type { EmailMessage, JobMessage } from './messages';

export async function handleQueue(
  batch: MessageBatch<EmailMessage | JobMessage>,
  env: Bindings,
): Promise<void> {
  const db = createDb(env.DB);

  for (const message of batch.messages) {
    try {
      if (batch.queue.endsWith('-jobs')) {
        await runJob(db, env, message.body as JobMessage, message.attempts);
      } else if (batch.queue.endsWith('-email')) {
        await deliverEmail(db, env, message.body as EmailMessage, message.attempts);
      }
      message.ack();
    } catch (err) {
      console.error(`queue ${batch.queue} message ${message.id} failed`, err);
      message.retry({ delaySeconds: Math.min(60 * 2 ** message.attempts, 3600) });
    }
  }
}
