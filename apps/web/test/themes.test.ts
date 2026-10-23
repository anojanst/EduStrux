import { THEME_KEYS, THEMES } from '@edustrux/shared/themes';
import { describe, expect, it } from 'vitest';

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('org themes (D-165, D-166)', () => {
  it.each(THEME_KEYS)('%s passes WCAG AA for every text pair', (key) => {
    const t = THEMES[key];
    const pairs: [string, string][] = [
      ['#ffffff', t.brand],
      ['#ffffff', t.brandHover],
      [t.brand, t.brandSoft],
      [t.brand, t.sidebarActive],
      [t.sidebarText, t.sidebar],
      [t.sidebarText, t.sidebarRaised],
      [t.sidebarStrong, t.sidebar],
      [t.sidebarStrong, t.sidebarRaised],
    ];
    for (const [text, background] of pairs) {
      expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
