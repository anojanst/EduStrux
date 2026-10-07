import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env';
import { ApiError, errorBody } from './lib/errors';
import { createRouter } from './lib/openapi';
import { withDb } from './middleware/db';
import { branchRoutes } from './modules/branches/routes';
import { curriculumRoutes } from './modules/curriculum/routes';
import { meRoutes } from './modules/me/routes';
import { orgRoutes } from './modules/orgs/routes';
import { platformRoutes } from './modules/platform/routes';

const docsEnabled = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ENABLE_DOCS !== 'true') return c.json(errorBody('not_found', 'Route not found'), 404);
  await next();
});

export function createApp(): OpenAPIHono<AppEnv> {
  const app = createRouter();

  app.use('/api/*', withDb);

  app.route('/', platformRoutes);
  app.route('/', meRoutes);
  app.route('/', orgRoutes);
  app.route('/', branchRoutes);
  app.route('/', curriculumRoutes);

  // API docs: generated from the route definitions above.
  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'A Clerk session token. Locally, run `pnpm dev:token owner` and paste the printed token.',
  });
  app.use('/api/openapi.json', docsEnabled);
  app.use('/api/docs', docsEnabled);
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'EduStrux API',
      version: 'v1',
      description:
        'Tuition centre management API. Org data lives under `/api/v1/orgs/{orgId}`. ' +
        'Money is integer minor units plus currency. Lists use cursor paging (`limit`, `cursor` → `nextCursor`).',
    },
    security: [{ Bearer: [] }],
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json', persistAuthorization: true }));

  app.notFound((c) => c.json(errorBody('not_found', 'Route not found'), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message, err.fields), err.status);
    }
    if (err instanceof HTTPException && err.status === 400) {
      // e.g. malformed JSON body
      return c.json(errorBody('validation_failed', err.message), 400);
    }
    if (err instanceof HTTPException) {
      return c.json(errorBody('internal_error', err.message), err.status);
    }
    console.error(err);
    const message = c.env.ENVIRONMENT === 'production' ? 'Something went wrong' : err.message;
    return c.json(errorBody('internal_error', message), 500);
  });

  return app;
}
