// Cursor paging over prefixed ULIDs, which sort by creation time.
// The cursor is opaque to clients: base64url of the last id on the page.

export function encodeCursor(id: string): string {
  return btoa(id).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return undefined;
  }
}

/** Pass rows fetched with `limit + 1`; the extra row tells us there's another page. */
export function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null };
}
