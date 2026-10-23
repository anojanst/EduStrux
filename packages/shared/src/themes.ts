/**
 * The org's colour themes (D-165). An owner picks one; there is no free colour. Every pair used
 * for text passes WCAG AA: white on `brand`, `brand` on `brandSoft`, and `sidebarText` on
 * `sidebar` and `sidebarRaised`. The web, PDFs and emails all read their colours from here.
 */
export const THEME_KEYS = [
  'teal',
  'ocean',
  'indigo',
  'violet',
  'berry',
  'forest',
  'amber',
  'graphite',
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const DEFAULT_THEME: ThemeKey = 'teal';

export type ThemeColours = {
  brand: string;
  brandHover: string;
  brandSoft: string;
  sidebar: string;
  sidebarRaised: string;
  sidebarText: string;
};

export const THEMES: Record<ThemeKey, ThemeColours> = {
  teal: {
    brand: '#155d63',
    brandHover: '#104c51',
    brandSoft: '#e7f2f1',
    sidebar: '#123f43',
    sidebarRaised: '#1a4d52',
    sidebarText: '#c9d9da',
  },
  ocean: {
    brand: '#1d5fa8',
    brandHover: '#174d8a',
    brandSoft: '#e8f0fa',
    sidebar: '#14365e',
    sidebarRaised: '#1c446f',
    sidebarText: '#c8d6e8',
  },
  indigo: {
    brand: '#4338ca',
    brandHover: '#3730a3',
    brandSoft: '#eef0fd',
    sidebar: '#262466',
    sidebarRaised: '#302e78',
    sidebarText: '#cfd0ee',
  },
  violet: {
    brand: '#6d3fc0',
    brandHover: '#5a33a0',
    brandSoft: '#f2ecfb',
    sidebar: '#36215e',
    sidebarRaised: '#432a72',
    sidebarText: '#d8cdea',
  },
  berry: {
    brand: '#b4235a',
    brandHover: '#961c4a',
    brandSoft: '#fcebf1',
    sidebar: '#5a1630',
    sidebarRaised: '#6b1d3a',
    sidebarText: '#ecc9d6',
  },
  forest: {
    brand: '#23744a',
    brandHover: '#1c5f3c',
    brandSoft: '#e8f4ed',
    sidebar: '#173f2b',
    sidebarRaised: '#1f4d35',
    sidebarText: '#c7ddd0',
  },
  amber: {
    brand: '#b45309',
    brandHover: '#92430a',
    brandSoft: '#fdf1e6',
    sidebar: '#4f2a0b',
    sidebarRaised: '#5f3410',
    sidebarText: '#ecd5bf',
  },
  graphite: {
    brand: '#3f4f5c',
    brandHover: '#33414c',
    brandSoft: '#edf0f2',
    sidebar: '#1f2a33',
    sidebarRaised: '#29363f',
    sidebarText: '#c9d1d7',
  },
};

/** The theme's colours, falling back to the default for a key this build doesn't know. */
export function themeColours(key: string | null | undefined): ThemeColours {
  return THEMES[key as ThemeKey] ?? THEMES[DEFAULT_THEME];
}
