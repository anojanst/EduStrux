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

type Options = { body?: unknown; signal?: AbortSignal; auth?: boolean };

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

/** The first message for each field of a 400 or 422, keyed by its dotted path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(
    Object.entries(error.fields).flatMap(([field, messages]) =>
      messages[0] ? [[field, messages[0]]] : [],
    ),
  );
}
