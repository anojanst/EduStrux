// Money is stored as integer minor units plus an ISO 4217 code: { amount: 2490, currency: "NZD" }.
// Decimal places come from this fixed table, not from the runtime's Intl data, so stored amounts
// mean the same thing in Workers, browsers and React Native.

/** ISO 4217 currencies whose minor unit isn't 2. Every other code has 2 decimal places. */
// prettier-ignore
const MINOR_UNITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

export type MoneyValue = { amount: number; currency: string };

/** Decimal places in the currency's minor unit, e.g. NZD 2, JPY 0, KWD 3. */
export function currencyDecimals(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
}

/**
 * A decimal string to integer minor units, without floats: ("24.90", "NZD") → 2490.
 * Throws a RangeError for malformed input or more decimals than the currency has.
 */
export function toMinorUnits(amount: string, currency: string): number {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new RangeError(`Not a decimal amount: "${amount}"`);
  const [, sign, whole, fraction = ''] = match;
  const decimals = currencyDecimals(currency);
  if (fraction.length > decimals) {
    throw new RangeError(`${currency} has ${decimals} decimal places: "${amount}"`);
  }
  const minor = Number(whole + fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Amount too large: "${amount}"`);
  return sign && minor !== 0 ? -minor : minor;
}

/** Integer minor units to a plain decimal string: (2490, "NZD") → "24.90". */
export function fromMinorUnits(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Not integer minor units: ${amount}`);
  const decimals = currencyDecimals(currency);
  const digits = String(Math.abs(amount)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return (amount < 0 ? '-' : '') + (decimals ? `${whole}.${fraction}` : whole);
}

/** For display: ({ amount: 2490, currency: "NZD" }, "en-NZ") → "$24.90". */
export function formatMoney(money: MoneyValue, locale: string): string {
  const decimals = currencyDecimals(money.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(money.amount / 10 ** decimals);
}
