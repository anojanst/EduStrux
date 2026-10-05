import {
  addDays,
  currencyDecimals,
  diffDays,
  eachDate,
  formatDate,
  formatMoney,
  formatTime,
  formatTimestamp,
  fromMinorUnits,
  Locale,
  localNow,
  localToUtc,
  parseLocalDate,
  toMinorUnits,
  utcToLocal,
  weekday,
} from '@edustrux/shared';
import { describe, expect, it } from 'vitest';

// Intl output uses no-break and narrow no-break spaces; compare with plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('money', () => {
  it('uses the ISO 4217 decimal places', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('NZD')).toBe(2);
    expect(currencyDecimals('LKR')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(3);
  });

  it('converts decimal strings to minor units without floats', () => {
    expect(toMinorUnits('24.90', 'NZD')).toBe(2490);
    expect(toMinorUnits('24.9', 'NZD')).toBe(2490);
    expect(toMinorUnits('0.29', 'NZD')).toBe(29); // 0.29 * 100 is 28.999… as a float
    expect(toMinorUnits('-5.05', 'NZD')).toBe(-505);
    expect(toMinorUnits('-0.00', 'NZD')).toBe(0);
    expect(toMinorUnits('1500', 'JPY')).toBe(1500);
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
  });

  it('rejects malformed amounts and extra decimals', () => {
    for (const bad of ['', 'abc', '1e3', '1,000.00', '.5', '24.']) {
      expect(() => toMinorUnits(bad, 'NZD')).toThrow(RangeError);
    }
    expect(() => toMinorUnits('24.999', 'NZD')).toThrow(RangeError);
    expect(() => toMinorUnits('1.5', 'JPY')).toThrow(RangeError);
    expect(() => toMinorUnits('99999999999999999', 'NZD')).toThrow(RangeError);
  });

  it('converts minor units back to decimal strings', () => {
    expect(fromMinorUnits(2490, 'NZD')).toBe('24.90');
    expect(fromMinorUnits(5, 'NZD')).toBe('0.05');
    expect(fromMinorUnits(-505, 'NZD')).toBe('-5.05');
    expect(fromMinorUnits(1500, 'JPY')).toBe('1500');
    expect(fromMinorUnits(1234, 'KWD')).toBe('1.234');
    expect(() => fromMinorUnits(24.9, 'NZD')).toThrow(RangeError);
  });

  it('formats for display in the org locale', () => {
    expect(formatMoney({ amount: 2490, currency: 'NZD' }, 'en-NZ')).toBe('$24.90');
    expect(formatMoney({ amount: 1500, currency: 'JPY' }, 'en-US')).toBe('¥1,500');
    expect(plain(formatMoney({ amount: 1234, currency: 'KWD' }, 'en-GB'))).toBe('KWD 1.234');
    // India groups in lakhs and crores.
    expect(plain(formatMoney({ amount: 123456750, currency: 'LKR' }, 'en-IN'))).toBe(
      'LKR 12,34,567.50',
    );
  });
});

describe('calendar dates', () => {
  it('parses YYYY-MM-DD by hand and rejects impossible dates', () => {
    expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-2-3', '0026-01-01']) {
      expect(() => parseLocalDate(bad)).toThrow(RangeError);
    }
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-05', 7)).toBe('2026-10-12');
    expect(diffDays('2026-10-05', '2026-10-12')).toBe(7);
    expect(diffDays('2026-10-12', '2026-10-05')).toBe(-7);
  });

  it('gives ISO weekdays and inclusive date ranges', () => {
    expect(weekday('2026-10-05')).toBe(1); // Monday
    expect(weekday('2026-10-11')).toBe(7); // Sunday
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(eachDate('2026-10-05', '2026-10-05')).toEqual(['2026-10-05']);
    expect(eachDate('2026-10-06', '2026-10-05')).toEqual([]);
  });

  it('formats in each org date format', () => {
    expect(formatDate('2026-10-04', 'DD/MM/YYYY')).toBe('04/10/2026');
    expect(formatDate('2026-10-04', 'MM/DD/YYYY')).toBe('10/04/2026');
    expect(formatDate('2026-10-04', 'YYYY-MM-DD')).toBe('2026-10-04');
  });
});

describe('timezones', () => {
  it('converts local time to UTC with and without daylight saving', () => {
    // Asia/Colombo is +05:30 all year.
    expect(localToUtc('2026-10-14', '16:00', 'Asia/Colombo')).toBe('2026-10-14T10:30:00.000Z');
    // Auckland: +12 in winter, +13 in summer.
    expect(localToUtc('2026-07-14', '16:00', 'Pacific/Auckland')).toBe('2026-07-14T04:00:00.000Z');
    expect(localToUtc('2026-10-14', '16:00', 'Pacific/Auckland')).toBe('2026-10-14T03:00:00.000Z');
    // New York: -5 in winter, -4 in summer.
    expect(localToUtc('2026-01-14', '16:00', 'America/New_York')).toBe('2026-01-14T21:00:00.000Z');
    expect(localToUtc('2026-07-14', '16:00', 'America/New_York')).toBe('2026-07-14T20:00:00.000Z');
  });

  it('keeps a weekly 4 pm lesson at 4 pm across the clock change', () => {
    const weeks = ['2026-09-20', '2026-09-27'].map((d) =>
      localToUtc(d, '16:00', 'Pacific/Auckland'),
    );
    expect(weeks).toEqual(['2026-09-20T04:00:00.000Z', '2026-09-27T03:00:00.000Z']);
    expect(weeks.map((w) => utcToLocal(w, 'Pacific/Auckland').time)).toEqual(['16:00', '16:00']);
  });

  it('moves a time skipped by spring-forward forward by the gap (D-016)', () => {
    // Auckland 2026-09-27: 02:00 NZST jumps to 03:00 NZDT.
    expect(localToUtc('2026-09-27', '02:30', 'Pacific/Auckland')).toBe('2026-09-26T14:30:00.000Z');
    expect(utcToLocal('2026-09-26T14:30:00.000Z', 'Pacific/Auckland').time).toBe('03:30');
    expect(localToUtc('2026-09-27', '02:00', 'Pacific/Auckland')).toBe('2026-09-26T14:00:00.000Z');
    // New York 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    expect(localToUtc('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    expect(utcToLocal('2026-03-08T07:30:00.000Z', 'America/New_York').time).toBe('03:30');
  });

  it('uses the earlier of a time repeated by fall-back (D-016)', () => {
    // Auckland 2026-04-05: 03:00 NZDT goes back to 02:00 NZST, so 02:30 happens twice.
    expect(localToUtc('2026-04-05', '02:30', 'Pacific/Auckland')).toBe('2026-04-04T13:30:00.000Z');
    expect(utcToLocal('2026-04-04T14:30:00.000Z', 'Pacific/Auckland').time).toBe('02:30');
    // New York 2026-11-01: 02:00 EDT goes back to 01:00 EST, so 01:30 happens twice.
    expect(localToUtc('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });

  it('reads local date, time and hour from an instant', () => {
    expect(utcToLocal('2026-10-14T10:30:00.000Z', 'Asia/Colombo')).toEqual({
      date: '2026-10-14',
      time: '16:00',
      hour: 16,
    });
    // Midnight is hour 0, not 24, and the local date is a day ahead of UTC.
    expect(utcToLocal('2026-10-13T11:00:00.000Z', 'Pacific/Auckland')).toEqual({
      date: '2026-10-14',
      time: '00:00',
      hour: 0,
    });
    expect(localNow('America/New_York', new Date('2026-10-05T03:15:00Z'))).toEqual({
      date: '2026-10-04',
      time: '23:15',
      hour: 23,
    });
    expect(() => utcToLocal('not a date', 'Pacific/Auckland')).toThrow(RangeError);
  });

  it('formats times and timestamps for the org', () => {
    expect(formatTime('16:00', 'en-GB')).toBe('16:00');
    expect(formatTime('00:05', 'en-GB')).toBe('00:05');
    expect(plain(formatTime('16:00', 'en-NZ'))).toBe('4:00 pm');
    expect(plain(formatTime('16:00', 'en-US'))).toBe('4:00 PM');
    expect(() => formatTime('24:00', 'en-GB')).toThrow(RangeError);

    const org = {
      timezone: 'Pacific/Auckland',
      locale: 'en-NZ',
      dateFormat: 'DD/MM/YYYY',
    } as const;
    expect(plain(formatTimestamp('2026-10-14T03:00:00.000Z', org))).toBe('14/10/2026 4:00 pm');
    expect(
      formatTimestamp('2026-10-14T20:00:00.000Z', {
        timezone: 'America/New_York',
        locale: 'en-GB',
        dateFormat: 'YYYY-MM-DD',
      }),
    ).toBe('2026-10-14 16:00');
  });
});

describe('Locale validator (D-015)', () => {
  it('accepts English variants only', () => {
    // "eng" is the ISO 639-2 alias that Intl canonicalises to "en".
    for (const ok of ['en', 'en-NZ', 'en-IN', 'en-GB', 'en-US', 'en-ZA', 'EN-gb', 'eng-NZ']) {
      expect(Locale.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['fr-FR', 'de-DE', 'ta-LK', 'english', '', 'not a locale']) {
      expect(Locale.safeParse(bad).success, bad).toBe(false);
    }
  });
});
