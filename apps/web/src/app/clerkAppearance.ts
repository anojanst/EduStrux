import type { ClerkProviderProps } from '@clerk/react';

/**
 * Clerk's sign-in and sign-up components in the app's tokens (ui-design.md §2–4): brand teal,
 * Inter, 8px radius, a bordered card with no shadow. `cssLayerName` puts Clerk's styles in a
 * layer below Tailwind's utilities, so the classes here win.
 */
export const clerkAppearance: ClerkProviderProps['appearance'] = {
  cssLayerName: 'clerk',
  variables: {
    colorPrimary: '#155d63',
    colorPrimaryForeground: '#ffffff',
    colorForeground: '#192229',
    colorMutedForeground: '#66747d',
    colorBackground: '#ffffff',
    colorInput: '#ffffff',
    colorInputForeground: '#192229',
    colorBorder: '#d7dfe1',
    colorRing: '#155d63',
    colorDanger: '#b34444',
    colorSuccess: '#277a5b',
    colorWarning: '#9a6015',
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
    fontFamilyButtons: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: '14px',
    borderRadius: '8px',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full max-w-none shadow-none border border-border rounded-xl',
    card: 'shadow-none',
  },
};
