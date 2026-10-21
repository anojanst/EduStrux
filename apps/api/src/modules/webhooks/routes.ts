import { createRoute, z } from '@hono/zod-openapi';
import { createRouter, errors, json } from '../../lib/openapi';
import * as service from './service';

const Received = z
  .object({ received: z.literal(true), duplicate: z.boolean() })
  .openapi('WebhookReceived');

const SvixHeaders = z.object({
  'svix-id': z.string().optional(),
  'svix-timestamp': z.string().optional(),
  'svix-signature': z.string().optional(),
});

const webhookRoute = (source: 'clerk' | 'resend', summary: string, description: string) =>
  createRoute({
    method: 'post',
    path: `/api/v1/webhooks/${source}`,
    tags: ['Webhooks'],
    summary,
    description:
      `${description} No sign-in: the Svix signature (\`svix-id\`, \`svix-timestamp\`, ` +
      '`svix-signature`) is checked against the webhook secret; a bad or stale one is 401, and ' +
      'without the secret it is 503. A delivery already handled answers `duplicate: true`.',
    security: [],
    request: {
      headers: SvixHeaders,
      body: {
        required: true,
        content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
      },
    },
    responses: { 200: json(Received, 'Received'), ...errors(400, 401, 503) },
  });

const clerkRoute = webhookRoute(
  'clerk',
  'Clerk webhook',
  'Keeps users in step with Clerk: `user.created` and `user.updated` store the primary email ' +
    'and name; `user.deleted` suspends the user’s memberships in every org.',
);

const resendRoute = webhookRoute(
  'resend',
  'Resend webhook',
  'Records what happened to a message’s email: `email.delivered`, `email.bounced`, ' +
    '`email.complained` and `email.failed`, by the `org_id` and `recipient_id` tags it was sent with.',
);

export const webhookRoutes = createRouter()
  // The signature is over the exact bytes sent, so the body is read raw, not as parsed JSON.
  .openapi(clerkRoute, async (c) =>
    c.json(await service.clerkWebhook(c.var.db, c.env, c.req.raw.headers, await c.req.text()), 200),
  )
  .openapi(resendRoute, async (c) =>
    c.json(
      await service.resendWebhook(c.var.db, c.env, c.req.raw.headers, await c.req.text()),
      200,
    ),
  );
