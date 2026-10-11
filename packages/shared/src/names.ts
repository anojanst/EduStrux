// Names are stored twice: as typed, and normalised for prefix search, duplicate warnings and
// alphabetical lists. The API and the web app must normalise the same way.

/** Lower-case, accents stripped, spaces collapsed: "  Zoë  O'Brien " → "zoe o'brien". */
export function normaliseName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
