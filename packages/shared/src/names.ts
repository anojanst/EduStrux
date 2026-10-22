// Names are stored twice: as typed, and normalised for prefix search, duplicate warnings and
// alphabetical lists. The API and the web app must normalise the same way.

/** Lower-case, accents stripped, spaces collapsed: "  Zoë  O'Brien " → "zoe o'brien". */
export function normaliseName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * A phone number's digits alone, for an exact search: "+64 21-555 0100" → "64215550100". null
 * when there are none.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  return digits.length > 0 ? digits : null;
}
