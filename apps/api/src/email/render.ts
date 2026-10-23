import { themeColours } from '@edustrux/shared';
import { t } from './catalog';

/** An email ready to send: the subject, and the body as HTML and as plain text. */
export type RenderedEmail = { subject: string; html: string; text: string };

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Plain text as HTML paragraphs: a blank line starts a paragraph, a newline breaks a line. */
function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block).replaceAll('\n', '<br>')}</p>`)
    .join('\n');
}

/**
 * The org's email around a subject and plain-text body: the same layout for announcements,
 * automatic messages and invitations, headed by the org's name in its theme colour (D-165).
 * Nothing in it is trusted as HTML.
 */
export function renderEmail(input: {
  orgName: string;
  theme: string;
  subject: string;
  body: string;
}): RenderedEmail {
  const footer = t('email.footer', { orgName: input.orgName });
  const { brand } = themeColours(input.theme);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(input.subject)}</title></head>
<body style="font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2933; line-height: 1.5; max-width: 600px; margin: 0 auto; padding: 24px;">
<p style="border-bottom: 3px solid ${brand}; color: ${brand}; font-size: 18px; font-weight: 600; margin: 0 0 20px; padding-bottom: 12px;">${escape(input.orgName)}</p>
${paragraphs(input.body)}
<hr style="border: none; border-top: 1px solid #e4e7eb; margin: 24px 0;">
<p style="color: #616e7c; font-size: 13px;">${escape(footer)}</p>
</body></html>`;
  return { subject: input.subject, html, text: `${input.body}\n\n--\n${footer}` };
}
