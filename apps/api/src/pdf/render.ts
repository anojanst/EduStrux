import type { Bindings } from '../env';
import { unavailable } from '../lib/errors';

/**
 * Turns a page of HTML into a PDF with Cloudflare Browser Rendering's REST API (D-025). Not set up
 * (no account id or token), or not answering, is 503: the caller can still offer the HTML.
 */
export async function renderPdf(
  env: Bindings,
  html: string,
  fetchFn: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const account = env.BROWSER_RENDERING_ACCOUNT_ID;
  const token = env.BROWSER_RENDERING_TOKEN;
  if (!account || !token) {
    throw unavailable('PDFs are not set up yet. Ask for `?format=html` for a printable page.');
  }
  const res = await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/pdf`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        pdfOptions: {
          format: 'a4',
          printBackground: true,
          margin: { top: '16mm', bottom: '16mm' },
        },
      }),
    },
  );
  if (!res.ok) {
    console.error(`browser rendering ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw unavailable('The PDF could not be made just now. Try again shortly.');
  }
  return res.arrayBuffer();
}
