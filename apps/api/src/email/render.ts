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

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#192229';
const MUTED = '#5b6873';
const LINE = '#e3e8ec';
const CANVAS = '#f3f5f7';

/** Plain text as HTML paragraphs: a blank line starts a paragraph, a newline breaks a line. */
function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin: 0 0 16px; font-size: 15px; line-height: 24px; color: ${INK};">${escape(block).replaceAll('\n', '<br>')}</p>`,
    )
    .join('\n');
}

/** A button that holds up in Outlook too: a one-cell table in the brand colour around the link. */
function button(label: string, url: string, brand: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 20px;"><tr>
<td bgcolor="${brand}" style="border-radius: 8px;"><a href="${escape(url)}" target="_blank" style="display: inline-block; padding: 12px 22px; font-family: ${FONT}; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">${escape(label)}</a></td>
</tr></table>
<p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; color: ${MUTED};">${escape(t('email.buttonHelp'))}</p>
<p style="margin: 0 0 16px; font-size: 13px; line-height: 20px; word-break: break-all;"><a href="${escape(url)}" target="_blank" style="color: ${brand};">${escape(url)}</a></p>`;
}

/**
 * The org's email around a subject and plain-text body: the same layout for announcements,
 * automatic messages and invitations (TUI-137). A white card on a grey canvas, headed by the org's
 * initial and name in its theme colour (D-165), the subject as the heading, then the body, an
 * optional button with its link spelt out, an optional note, and the footer. With `appUrl`, the
 * footer shows the EduStrux logo from the web app (`/email-logo.png`). Nothing in it is trusted as
 * HTML.
 */
export function renderEmail(input: {
  orgName: string;
  theme: string;
  subject: string;
  body: string;
  action?: { label: string; url: string };
  note?: string;
  appUrl?: string;
}): RenderedEmail {
  const footer = t('email.footer', { orgName: input.orgName });
  const { brand } = themeColours(input.theme);
  const initial = escape(input.orgName.trim().charAt(0).toUpperCase() || '·');
  // The inbox's preview line: the body's first paragraph, not the header's org name.
  const preview = escape(
    input.body
      .split(/\n{2,}/)[0]!
      .replaceAll('\n', ' ')
      .slice(0, 140),
  );
  const poweredBy = input.appUrl
    ? `<img src="${escape(`${input.appUrl.replace(/\/$/, '')}/email-logo.png`)}" width="70" height="20" alt="EduStrux" style="display: inline-block; border: 0; vertical-align: middle;">`
    : 'EduStrux';

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(input.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${CANVAS}; font-family: ${FONT}; color: ${INK};">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}"><tr><td align="center" style="padding: 32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">
<tr><td bgcolor="#ffffff" style="background: #ffffff; border: 1px solid ${LINE}; border-top: 4px solid ${brand}; border-radius: 12px; padding: 28px 32px; font-family: ${FONT};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px;"><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="${brand}" style="width: 36px; height: 36px; border-radius: 8px; color: #ffffff; font-size: 17px; font-weight: 700; font-family: ${FONT};">${initial}</td>
<td style="padding-left: 12px; color: ${brand}; font-size: 17px; font-weight: 700; font-family: ${FONT};">${escape(input.orgName)}</td>
</tr></table>
<h1 style="margin: 0 0 16px; font-size: 21px; line-height: 28px; font-weight: 700; color: ${INK};">${escape(input.subject)}</h1>
${paragraphs(input.body)}
${input.action ? button(input.action.label, input.action.url, brand) : ''}
${input.note ? `<p style="margin: 0; padding-top: 16px; border-top: 1px solid ${LINE}; font-size: 13px; line-height: 20px; color: ${MUTED};">${escape(input.note)}</p>` : ''}
</td></tr>
<tr><td align="center" style="padding: 20px 16px 0; font-family: ${FONT}; font-size: 12px; line-height: 20px; color: ${MUTED};">
${escape(footer)}<br>
<span style="color: ${MUTED};">${escape(t('email.poweredBy'))}</span> ${poweredBy}
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    input.body,
    input.action ? `${input.action.label}: ${input.action.url}` : '',
    input.note ?? '',
    `--\n${footer}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { subject: input.subject, html, text };
}
