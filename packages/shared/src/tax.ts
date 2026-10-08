// Tax rates travel as decimal strings ("8.875") and are stored as integer thousandths of a
// percent (8875), so a rate is never a float.

const PERCENT = /^(\d{1,3})(?:\.(\d{1,3}))?$/;

/** "8.875" → 8875, "15" → 15000. Returns null for anything that isn't 0–100 with ≤ 3 decimals. */
export function percentToMilli(percent: string): number | null {
  const match = PERCENT.exec(percent);
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return milli <= 100_000 ? milli : null;
}

/** 8875 → "8.875", 15000 → "15", 12500 → "12.5". */
export function milliToPercent(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
