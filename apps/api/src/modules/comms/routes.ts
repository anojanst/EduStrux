import { createRoute, z } from '@hono/zod-openapi';
import {
  CreateMessage,
  CreateMessageTemplate,
  Message,
  MessageDetail,
  MessageQuery,
  MessageTemplate,
  NotificationSettings,
  PageQuery,
  UpdateMessageTemplate,
  UpdateNotificationSettings,
  page,
} from '@edustrux/shared';
import { access, orgCtx } from '../../db/scope';
import { createRouter, errors, json, jsonBody } from '../../lib/openapi';
import { orgAccess } from '../../middleware/permission';
import { OrgParams } from '../orgs/routes';
import * as service from './service';

// Messages go to the guardians of families: by email, and in the parent portal. Staff with
// `messages:write` send announcements to the families they reach: the owner every family, branch
// staff their branches', a teacher their students'. The owner reads every message; anyone else
// the ones they sent. Parents read theirs in the portal (`GET /portal/messages`).

const MessageParams = OrgParams.extend({
  messageId: z.string().openapi({ param: { name: 'messageId', in: 'path' } }),
});
const TemplateParams = OrgParams.extend({
  templateId: z.string().openapi({ param: { name: 'templateId', in: 'path' } }),
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/messages',
  tags: ['Messages'],
  summary: 'List messages',
  description:
    'Newest first. The owner sees every message, automatic ones too; anyone else the ' +
    'announcements they sent. A parent gets 403: they read theirs in the portal.',
  middleware: orgAccess('messages:read'),
  request: { params: OrgParams, query: MessageQuery },
  responses: {
    200: json(page(Message).openapi('MessagePage'), 'A page of messages'),
    ...errors(400, 401, 403, 404),
  },
});

const sendMessageRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/messages',
  tags: ['Messages'],
  summary: 'Send an announcement',
  description:
    'To the guardians of the families the `audience` names, as far as you reach: branch staff ' +
    'their branches’ families, a teacher their students’. `all`; `branch` (home branch); ' +
    '`grade` (this academic year); `subject`, `class` or `teacher` (active enrolments); ' +
    '`custom` (families, 404 for one you can’t reach). By email to each guardian with an address ' +
    'and in the parent portal, or only the `channels` sent. A `templateId` fills in the subject ' +
    'and body not sent. 422 when nobody you reach is in the audience.',
  middleware: orgAccess('messages:write'),
  request: { params: OrgParams, body: jsonBody(CreateMessage) },
  responses: {
    201: json(Message, 'The message, with its emails queued'),
    ...errors(400, 401, 403, 404, 422),
  },
});

const getMessageRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/messages/{messageId}',
  tags: ['Messages'],
  summary: 'Get a message with its delivery',
  description:
    'Each recipient with their email’s status, and the counts by status. A message you can’t ' +
    'read is 404.',
  middleware: orgAccess('messages:read'),
  request: { params: MessageParams },
  responses: {
    200: json(MessageDetail, 'The message'),
    ...errors(401, 403, 404),
  },
});

const listTemplatesRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/message-templates',
  tags: ['Messages'],
  summary: 'List message templates',
  description: 'Oldest first. For everyone who sends messages.',
  middleware: orgAccess('messages:write'),
  request: { params: OrgParams, query: PageQuery },
  responses: {
    200: json(page(MessageTemplate).openapi('MessageTemplatePage'), 'A page of templates'),
    ...errors(400, 401, 403, 404),
  },
});

const createTemplateRoute = createRoute({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/message-templates',
  tags: ['Messages'],
  summary: 'Add a message template',
  description: 'Names are unique in the organisation, ignoring case (409). Owner only.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(CreateMessageTemplate) },
  responses: {
    201: json(MessageTemplate, 'The new template'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const updateTemplateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/orgs/{orgId}/message-templates/{templateId}',
  tags: ['Messages'],
  summary: 'Update a message template',
  description: 'Send the `updatedAt` you last read; a newer one returns 409. Owner only.',
  middleware: orgAccess('org:write'),
  request: { params: TemplateParams, body: jsonBody(UpdateMessageTemplate) },
  responses: {
    200: json(MessageTemplate, 'The updated template'),
    ...errors(400, 401, 403, 404, 409),
  },
});

const deleteTemplateRoute = createRoute({
  method: 'delete',
  path: '/api/v1/orgs/{orgId}/message-templates/{templateId}',
  tags: ['Messages'],
  summary: 'Delete a message template',
  description: 'Messages already sent with it keep their text. Owner only.',
  middleware: orgAccess('org:write'),
  request: { params: TemplateParams },
  responses: {
    204: { description: 'Deleted' },
    ...errors(401, 403, 404),
  },
});

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/api/v1/orgs/{orgId}/notification-settings',
  tags: ['Messages'],
  summary: 'Get the notification settings',
  description:
    'Which automatic messages go out: lesson changes, issued invoices and overdue reminders. ' +
    'The defaults until the owner saves them (`updatedAt: null`).',
  middleware: orgAccess('org:read'),
  request: { params: OrgParams },
  responses: {
    200: json(NotificationSettings, 'The settings'),
    ...errors(401, 403, 404),
  },
});

const saveSettingsRoute = createRoute({
  method: 'put',
  path: '/api/v1/orgs/{orgId}/notification-settings',
  tags: ['Messages'],
  summary: 'Save the notification settings',
  description: 'All of them at once; the later save wins. Owner only.',
  middleware: orgAccess('org:write'),
  request: { params: OrgParams, body: jsonBody(UpdateNotificationSettings) },
  responses: {
    200: json(NotificationSettings, 'The settings as saved'),
    ...errors(400, 401, 403, 404),
  },
});

export const commsRoutes = createRouter()
  .openapi(listMessagesRoute, async (c) => {
    const { limit, cursor, ...filter } = c.req.valid('query');
    return c.json(await service.listMessages(orgCtx(c), access(c), limit, cursor, filter), 200);
  })
  .openapi(sendMessageRoute, async (c) => {
    const message = await service.sendMessage(
      orgCtx(c),
      access(c),
      c.env.EMAIL_QUEUE,
      c.req.valid('json'),
    );
    return c.json(message, 201);
  })
  .openapi(getMessageRoute, async (c) => {
    const { messageId } = c.req.valid('param');
    return c.json(await service.getMessage(orgCtx(c), access(c), messageId), 200);
  })
  .openapi(listTemplatesRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query');
    return c.json(await service.listTemplates(orgCtx(c), limit, cursor), 200);
  })
  .openapi(createTemplateRoute, async (c) => {
    return c.json(await service.createTemplate(orgCtx(c), c.req.valid('json')), 201);
  })
  .openapi(updateTemplateRoute, async (c) => {
    const { templateId } = c.req.valid('param');
    return c.json(await service.updateTemplate(orgCtx(c), templateId, c.req.valid('json')), 200);
  })
  .openapi(deleteTemplateRoute, async (c) => {
    await service.deleteTemplate(orgCtx(c), c.req.valid('param').templateId);
    return c.body(null, 204);
  })
  .openapi(getSettingsRoute, async (c) => {
    return c.json(await service.getSettings(orgCtx(c)), 200);
  })
  .openapi(saveSettingsRoute, async (c) => {
    return c.json(await service.saveSettings(orgCtx(c), c.req.valid('json')), 200);
  });
