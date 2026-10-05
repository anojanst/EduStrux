import { createDb } from '@edustrux/db';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  c.set('db', createDb(c.env.DB));
  await next();
});
