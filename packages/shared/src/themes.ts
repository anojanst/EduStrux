/**
 * The org's colour themes (D-165, D-166). An owner picks one; there is no free colour. The first
 * eight have a dark sidebar, the last four a light one. Every pair used for text passes WCAG AA:
 * white on `brand`, `brand` on `brandSoft` and `sidebarActive`, and `sidebarText` and
 * `sidebarStrong` on `sidebar` and `sidebarRaised`. The web, PDFs and emails all read their
 * colours from here.
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
  'light-teal',
  'sky',
  'lavender',
  'rose',
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
  /** Names and hovered items in the sidebar. */
  sidebarStrong: string;
  /** The active nav item's pill, behind `brand` text. */
  sidebarActive: string;
};

export const THEMES: Record<ThemeKey, ThemeColours> = {
  teal: {
    brand: '#155d63',
    brandHover: '#104c51',
    brandSoft: '#e7f2f1',
    sidebar: '#123f43',
    sidebarRaised: '#1a4d52',
    sidebarText: '#c9d9da',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  ocean: {
    brand: '#1d5fa8',
    brandHover: '#174d8a',
    brandSoft: '#e8f0fa',
    sidebar: '#14365e',
    sidebarRaised: '#1c446f',
    sidebarText: '#c8d6e8',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  indigo: {
    brand: '#4338ca',
    brandHover: '#3730a3',
    brandSoft: '#eef0fd',
    sidebar: '#262466',
    sidebarRaised: '#302e78',
    sidebarText: '#cfd0ee',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  violet: {
    brand: '#6d3fc0',
    brandHover: '#5a33a0',
    brandSoft: '#f2ecfb',
    sidebar: '#36215e',
    sidebarRaised: '#432a72',
    sidebarText: '#d8cdea',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  berry: {
    brand: '#b4235a',
    brandHover: '#961c4a',
    brandSoft: '#fcebf1',
    sidebar: '#5a1630',
    sidebarRaised: '#6b1d3a',
    sidebarText: '#ecc9d6',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  forest: {
    brand: '#23744a',
    brandHover: '#1c5f3c',
    brandSoft: '#e8f4ed',
    sidebar: '#173f2b',
    sidebarRaised: '#1f4d35',
    sidebarText: '#c7ddd0',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  amber: {
    brand: '#b45309',
    brandHover: '#92430a',
    brandSoft: '#fdf1e6',
    sidebar: '#4f2a0b',
    sidebarRaised: '#5f3410',
    sidebarText: '#ecd5bf',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  graphite: {
    brand: '#3f4f5c',
    brandHover: '#33414c',
    brandSoft: '#edf0f2',
    sidebar: '#1f2a33',
    sidebarRaised: '#29363f',
    sidebarText: '#c9d1d7',
    sidebarStrong: '#ffffff',
    sidebarActive: '#ffffff',
  },
  'light-teal': {
    brand: '#155d63',
    brandHover: '#104c51',
    brandSoft: '#e7f2f1',
    sidebar: '#f3f8f8',
    sidebarRaised: '#e3eeee',
    sidebarText: '#3d5459',
    sidebarStrong: '#12343a',
    sidebarActive: '#d3e8e6',
  },
  sky: {
    brand: '#0369a1',
    brandHover: '#075985',
    brandSoft: '#e6f2fa',
    sidebar: '#f2f8fc',
    sidebarRaised: '#e1eef7',
    sidebarText: '#3b5163',
    sidebarStrong: '#0f2a3d',
    sidebarActive: '#d2e7f5',
  },
  lavender: {
    brand: '#6546c3',
    brandHover: '#5236a6',
    brandSoft: '#efebfb',
    sidebar: '#f7f5fd',
    sidebarRaised: '#ebe6f9',
    sidebarText: '#4a4560',
    sidebarStrong: '#241c3d',
    sidebarActive: '#e0d8f7',
  },
  rose: {
    brand: '#be185d',
    brandHover: '#9d174d',
    brandSoft: '#fcebf3',
    sidebar: '#fdf5f8',
    sidebarRaised: '#f8e5ee',
    sidebarText: '#5b4450',
    sidebarStrong: '#3a1426',
    sidebarActive: '#f8dbe7',
  },
};

/** The theme's colours, falling back to the default for a key this build doesn't know. */
export function themeColours(key: string | null | undefined): ThemeColours {
  return THEMES[key as ThemeKey] ?? THEMES[DEFAULT_THEME];
}
