import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { renderPdf } from './render';

/** `?format=html` gives the printable page itself; the default is the PDF made from it. */
export const DocumentQuery = z.object({
  format: z.enum(['pdf', 'html']).default('pdf').openapi({
    description: '`pdf` (the default), or `html` for the printable page the PDF is made from.',
  }),
});

/** The OpenAPI answer for a document: a PDF, or its HTML. */
export function documentResponse(description: string) {
  return {
    description,
    content: {
      'application/pdf': { schema: z.string().openapi({ format: 'binary' }) },
      'text/html': { schema: z.string() },
    },
  };
}

/** Sends the page as asked: as HTML, or as a PDF made by Browser Rendering (503 without it). */
export async function sendDocument(
  c: Context<AppEnv>,
  html: string,
  filename: string,
  format: 'pdf' | 'html',
) {
  if (format === 'html') {
    return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  const pdf = await renderPdf(c.env, html);
  return c.body(pdf, 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}.pdf"`,
  });
}
