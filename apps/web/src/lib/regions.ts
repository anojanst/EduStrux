import type { DateFormat } from '@edustrux/shared';

/**
 * Countries offered first when setting up a centre, with the currency each uses. Any other
 * country can still be typed through "Other", picking the currency by hand.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  AU: 'AUD',
  BD: 'BDT',
  CA: 'CAD',
  AE: 'AED',
  GB: 'GBP',
  HK: 'HKD',
  IE: 'EUR',
  IN: 'INR',
  KE: 'KES',
  LK: 'LKR',
  MY: 'MYR',
  NG: 'NGN',
  NZ: 'NZD',
  PH: 'PHP',
  PK: 'PKR',
  SG: 'SGD',
  US: 'USD',
  ZA: 'ZAR',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });

export const COUNTRIES = Object.keys(COUNTRY_CURRENCY)
  .map((code) => ({ code, name: regionNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function currencyFor(country: string): string | null {
  return COUNTRY_CURRENCY[country] ?? null;
}

export function currencyOptions() {
  return Intl.supportedValuesOf('currency').map((code) => ({
    value: code,
    label: `${code} · ${currencyNames.of(code) ?? code}`,
  }));
}

export function timeZoneOptions() {
  return Intl.supportedValuesOf('timeZone').map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  }));
}

/** The org's formatting region: English variants only (D-015), e.g. en-NZ. */
export function localeFor(country: string): string {
  if (!country) return 'en-GB';
  try {
    const [canonical] = Intl.getCanonicalLocales(`en-${country}`);
    return canonical ?? 'en-GB';
  } catch {
    return 'en-GB';
  }
}

export function dateFormatFor(country: string): DateFormat {
  return country === 'US' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
}

/** A first guess from the browser: its time zone, and the country in its language tag. */
export function browserDefaults() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase();
  const country = region in COUNTRY_CURRENCY ? region : '';
  return { timeZone, country, currency: currencyFor(country) ?? 'USD' };
}
