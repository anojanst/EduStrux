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

/**
 * Pass rows fetched with `limit + 1`; the extra row tells us there's another page.
 * `keyOf` is what the cursor holds: the id by default, or e.g. `byStartDate` for date order.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => string = (row) => row.id,
) {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
}

// Lists ordered by start date (then id, for ties) carry both in the cursor: `<date>~<id>`.
export const byStartDate = (row: { startDate: string; id: string }) => `${row.startDate}~${row.id}`;

export function decodeStartDateCursor(cursor: string | undefined) {
  const [date, id] = decodeCursor(cursor)?.split('~') ?? [];
  return date && id ? { date, id } : undefined;
}
