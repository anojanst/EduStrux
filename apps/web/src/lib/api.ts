/** An error answer from the API: `{ error: { code, message, fields? } }` (D-015). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;

/** Set once by the auth provider: how a request gets the Clerk session token. */
export function setTokenGetter(getter: TokenGetter) {
  getToken = getter;
}

type Options = {
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  /** Sent as `Idempotency-Key`, so a retried payment or invoice action runs once. */
  idempotencyKey?: string;
};

/**
 * Calls `/api/v1{path}` with the signed-in user's Clerk token as a Bearer header. The API also
 * reads Clerk's `__session` cookie, but the header works the same on web and mobile.
 */
export async function api<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network', 'The server could not be reached');
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return body as T;

  const error = (body as { error?: { code?: string; message?: string; fields?: unknown } } | null)
    ?.error;
  throw new ApiError(
    res.status,
    error?.code ?? 'unknown',
    error?.message ?? res.statusText,
    (error?.fields as Record<string, string[]> | undefined) ?? {},
  );
}

/**
 * A document the API makes (an invoice PDF, a receipt), read with the user's token and opened in
 * a new tab. The tab opens first, so the browser doesn't block it as a pop-up.
 */
export async function openDocument(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const token = await getToken();
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      throw new ApiError(0, 'network', 'The server could not be reached');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiError(
        res.status,
        body?.error?.code ?? 'unknown',
        body?.error?.message ?? res.statusText,
      );
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) {
      tab.location.href = url;
    } else {
      // Pop-ups blocked: save the file instead of leaving the app.
      const link = document.createElement('a');
      link.href = url;
      link.download = '';
      link.click();
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/** The first message for each field of a 400 or 422, keyed by its dotted path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(
    Object.entries(error.fields).flatMap(([field, messages]) =>
      messages[0] ? [[field, messages[0]]] : [],
    ),
  );
}
