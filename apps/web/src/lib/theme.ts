import { themeColours, type ThemeColours } from '@edustrux/shared/themes';
import { useEffect, type CSSProperties } from 'react';

/** The ui-design §2 tokens a theme sets (D-165); every other colour stays the same. */
const VARS: Record<keyof ThemeColours, string> = {
  brand: '--brand',
  brandHover: '--brand-hover',
  brandSoft: '--brand-soft',
  sidebar: '--sidebar',
  sidebarRaised: '--sidebar-raised',
  sidebarText: '--sidebar-text',
};

/** The theme's tokens as inline styles, so `bg-brand` and friends inside take its colours. */
export function themeStyle(key: string | null | undefined): CSSProperties {
  const colours = themeColours(key);
  return Object.fromEntries(
    Object.entries(VARS).map(([name, cssVar]) => [cssVar, colours[name as keyof ThemeColours]]),
  ) as CSSProperties;
}

const remembered = (orgId: string) => `edustrux.theme.${orgId}`;

function rememberedTheme(orgId: string) {
  try {
    return localStorage.getItem(remembered(orgId));
  } catch {
    return null;
  }
}

/**
 * Colours the whole app with the org's theme while its pages are open. Until `GET /orgs/{id}`
 * answers, the theme this browser last saw for the org is used, so the app doesn't flash teal.
 * Leaving the org goes back to the stylesheet's default.
 */
export function useOrgTheme(orgId: string | undefined, theme: string | undefined) {
  useEffect(() => {
    if (!orgId) return;
    const key = theme ?? rememberedTheme(orgId);
    if (!key) return;
    if (theme) {
      try {
        localStorage.setItem(remembered(orgId), theme);
      } catch {
        // Private windows may refuse storage; the theme still applies.
      }
    }
    const root = document.documentElement.style;
    const colours = themeColours(key);
    for (const [name, cssVar] of Object.entries(VARS)) {
      root.setProperty(cssVar, colours[name as keyof ThemeColours]);
    }
    return () => {
      for (const cssVar of Object.values(VARS)) root.removeProperty(cssVar);
    };
  }, [orgId, theme]);
}
