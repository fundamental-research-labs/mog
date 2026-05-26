/**
 * Built-in Workbook Themes
 *
 * Built-in workbook themes that are always available.
 * These themes are defined in code (not Yjs) because:
 * 1. They never change and don't need collaboration
 * 2. They're immediately available without network sync
 * 3. They can be versioned with the code
 *
 * Custom themes are stored in Yjs per-workbook.
 *
 * Issue 4: Page Layout - Themes
 */

import type { FontThemeDefinition, ThemeDefinition } from '@mog-sdk/contracts/theme';
import { PRODUCT_VOCABULARY } from '../../ux/product-vocabulary';

// =============================================================================
// Built-in Themes
// =============================================================================

/**
 * Default workbook theme.
 * This is the most commonly used theme.
 */
export const OFFICE_THEME: ThemeDefinition = {
  id: 'office',
  name: PRODUCT_VOCABULARY.defaultTheme.label,
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#44546a',
    light2: '#e7e6e6',
    accent1: '#4472c4',
    accent2: '#ed7d31',
    accent3: '#a5a5a5',
    accent4: '#ffc000',
    accent5: '#5b9bd5',
    accent6: '#70ad47',
    hyperlink: '#0563c1',
    followedHyperlink: '#954f72',
  },
  fonts: {
    majorFont: 'Calibri Light',
    minorFont: 'Calibri',
  },
};

/**
 * Classic workbook theme.
 */
export const OFFICE_2007_THEME: ThemeDefinition = {
  id: 'office-2007',
  name: PRODUCT_VOCABULARY.classicTheme.label,
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#1f497d',
    light2: '#eeece1',
    accent1: '#4f81bd',
    accent2: '#c0504d',
    accent3: '#9bbb59',
    accent4: '#8064a2',
    accent5: '#4bacc6',
    accent6: '#f79646',
    hyperlink: '#0000ff',
    followedHyperlink: '#800080',
  },
  fonts: {
    majorFont: 'Cambria',
    minorFont: 'Calibri',
  },
};

/**
 * Slice theme - modern blue-green theme.
 */
export const SLICE_THEME: ThemeDefinition = {
  id: 'slice',
  name: 'Slice',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#146194',
    light2: '#cfdce3',
    accent1: '#052f61',
    accent2: '#a50e82',
    accent3: '#14967c',
    accent4: '#6a9e1f',
    accent5: '#e87d37',
    accent6: '#c62324',
    hyperlink: '#052f61',
    followedHyperlink: '#6a9e1f',
  },
  fonts: {
    majorFont: 'Century Gothic',
    minorFont: 'Century Gothic',
  },
};

/**
 * Vapor Trail theme - muted pastel theme.
 */
export const VAPOR_TRAIL_THEME: ThemeDefinition = {
  id: 'vapor-trail',
  name: 'Vapor Trail',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#454545',
    light2: '#dfdbd5',
    accent1: '#df8879',
    accent2: '#e8b54d',
    accent3: '#c9ba97',
    accent4: '#8ab39f',
    accent5: '#6a9cca',
    accent6: '#a093bd',
    hyperlink: '#6a9cca',
    followedHyperlink: '#a093bd',
  },
  fonts: {
    majorFont: 'Century Gothic',
    minorFont: 'Century Gothic',
  },
};

/**
 * Facet theme - bold modern theme.
 */
export const FACET_THEME: ThemeDefinition = {
  id: 'facet',
  name: 'Facet',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#2c3c43',
    light2: '#d5e0e2',
    accent1: '#90c226',
    accent2: '#54a021',
    accent3: '#e5b636',
    accent4: '#e87700',
    accent5: '#9c3a23',
    accent6: '#6d3f87',
    hyperlink: '#54a021',
    followedHyperlink: '#6d3f87',
  },
  fonts: {
    majorFont: 'Trebuchet MS',
    minorFont: 'Trebuchet MS',
  },
};

/**
 * Ion theme - vibrant modern theme.
 */
export const ION_THEME: ThemeDefinition = {
  id: 'ion',
  name: 'Ion',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#2a2f3b',
    light2: '#d5dde3',
    accent1: '#b01513',
    accent2: '#ea6312',
    accent3: '#e6b729',
    accent4: '#6bab90',
    accent5: '#55a5bf',
    accent6: '#ae4f7a',
    hyperlink: '#55a5bf',
    followedHyperlink: '#ae4f7a',
  },
  fonts: {
    majorFont: 'Century Gothic',
    minorFont: 'Century Gothic',
  },
};

/**
 * Integral theme - professional theme.
 */
export const INTEGRAL_THEME: ThemeDefinition = {
  id: 'integral',
  name: 'Integral',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#335b74',
    light2: '#dfe3e5',
    accent1: '#1cade4',
    accent2: '#2683c6',
    accent3: '#27ced7',
    accent4: '#42ba97',
    accent5: '#3e8853',
    accent6: '#62a39f',
    hyperlink: '#1cade4',
    followedHyperlink: '#3e8853',
  },
  fonts: {
    majorFont: 'Tw Cen MT',
    minorFont: 'Tw Cen MT',
  },
};

/**
 * Gallery theme - earth tones theme.
 */
export const GALLERY_THEME: ThemeDefinition = {
  id: 'gallery',
  name: 'Gallery',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#455f51',
    light2: '#e3ded1',
    accent1: '#a7c5bd',
    accent2: '#f0e5c9',
    accent3: '#c8b5a2',
    accent4: '#9b8574',
    accent5: '#6c534e',
    accent6: '#b5654f',
    hyperlink: '#6c534e',
    followedHyperlink: '#b5654f',
  },
  fonts: {
    majorFont: 'Gill Sans MT',
    minorFont: 'Gill Sans MT',
  },
};

// =============================================================================
// Theme Collection
// =============================================================================

/**
 * All built-in themes, in display order.
 */
export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  OFFICE_THEME,
  OFFICE_2007_THEME,
  SLICE_THEME,
  VAPOR_TRAIL_THEME,
  FACET_THEME,
  ION_THEME,
  INTEGRAL_THEME,
  GALLERY_THEME,
];

/**
 * Map of theme ID to theme definition for O(1) lookup.
 */
const THEME_MAP = new Map<string, ThemeDefinition>(
  BUILT_IN_THEMES.map((theme) => [theme.id, theme]),
);

// =============================================================================
// Theme Utilities
// =============================================================================

/**
 * Get a built-in theme by ID.
 *
 * @param id - Theme ID (e.g., 'office', 'slice')
 * @returns Theme definition or undefined if not found
 */
export function getBuiltInTheme(id: string): ThemeDefinition | undefined {
  return THEME_MAP.get(id);
}

/**
 * Get a theme by ID, falling back to custom theme if provided.
 * This is the primary theme resolution function for rendering.
 *
 * @param themeId - Theme ID from workbook settings
 * @param customTheme - Custom theme definition if themeId is 'custom'
 * @returns Theme definition (defaults to the built-in default if not found)
 *
 * @example
 * // Get built-in theme
 * const theme = getTheme('slice');
 *
 * // Get custom theme
 * const theme = getTheme('custom', myCustomTheme);
 *
 * // Falls back to the built-in default if not found
 * const theme = getTheme('unknown'); // Returns OFFICE_THEME
 */
export function getTheme(themeId: string, customTheme?: ThemeDefinition): ThemeDefinition {
  // Custom theme takes precedence when themeId is 'custom'
  if (themeId === 'custom' && customTheme) {
    return customTheme;
  }

  // Look up built-in theme
  const builtIn = THEME_MAP.get(themeId);
  if (builtIn) {
    return builtIn;
  }

  // Fall back to the built-in default theme
  return OFFICE_THEME;
}

/**
 * Check if a theme ID refers to a built-in theme.
 *
 * @param themeId - Theme ID to check
 * @returns True if the theme ID is a built-in theme
 */
export function isBuiltInTheme(themeId: string): boolean {
  return THEME_MAP.has(themeId);
}

/**
 * Get all theme IDs (built-in only).
 *
 * @returns Array of built-in theme IDs
 */
export function getBuiltInThemeIds(): string[] {
  return BUILT_IN_THEMES.map((theme) => theme.id);
}

// =============================================================================
// Built-in Font Themes
// =============================================================================

/**
 * Default font theme.
 */
export const OFFICE_FONT_THEME: FontThemeDefinition = {
  id: 'office',
  name: PRODUCT_VOCABULARY.defaultTheme.label,
  builtIn: true,
  fonts: {
    majorFont: 'Calibri Light',
    minorFont: 'Calibri',
  },
};

/**
 * Classic font theme.
 */
export const OFFICE_2007_FONT_THEME: FontThemeDefinition = {
  id: 'office-2007',
  name: PRODUCT_VOCABULARY.classicTheme.label,
  builtIn: true,
  fonts: {
    majorFont: 'Cambria',
    minorFont: 'Calibri',
  },
};

/**
 * Arial font theme - web-safe sans-serif.
 */
export const ARIAL_FONT_THEME: FontThemeDefinition = {
  id: 'arial',
  name: 'Arial',
  builtIn: true,
  fonts: {
    majorFont: 'Arial',
    minorFont: 'Arial',
  },
};

/**
 * Times New Roman font theme - classic serif.
 */
export const TIMES_FONT_THEME: FontThemeDefinition = {
  id: 'times',
  name: 'Times New Roman',
  builtIn: true,
  fonts: {
    majorFont: 'Times New Roman',
    minorFont: 'Times New Roman',
  },
};

/**
 * Georgia font theme - elegant serif.
 */
export const GEORGIA_FONT_THEME: FontThemeDefinition = {
  id: 'georgia',
  name: 'Georgia',
  builtIn: true,
  fonts: {
    majorFont: 'Georgia',
    minorFont: 'Georgia',
  },
};

/**
 * Century Gothic font theme - modern geometric sans-serif.
 */
export const CENTURY_GOTHIC_FONT_THEME: FontThemeDefinition = {
  id: 'century-gothic',
  name: 'Century Gothic',
  builtIn: true,
  fonts: {
    majorFont: 'Century Gothic',
    minorFont: 'Century Gothic',
  },
};

/**
 * Trebuchet MS font theme - humanist sans-serif.
 */
export const TREBUCHET_FONT_THEME: FontThemeDefinition = {
  id: 'trebuchet',
  name: 'Trebuchet MS',
  builtIn: true,
  fonts: {
    majorFont: 'Trebuchet MS',
    minorFont: 'Trebuchet MS',
  },
};

/**
 * Verdana font theme - wide sans-serif for screen readability.
 */
export const VERDANA_FONT_THEME: FontThemeDefinition = {
  id: 'verdana',
  name: 'Verdana',
  builtIn: true,
  fonts: {
    majorFont: 'Verdana',
    minorFont: 'Verdana',
  },
};

// =============================================================================
// Font Theme Collection
// =============================================================================

/**
 * All built-in font themes, in display order.
 */
export const BUILT_IN_FONT_THEMES: readonly FontThemeDefinition[] = [
  OFFICE_FONT_THEME,
  OFFICE_2007_FONT_THEME,
  ARIAL_FONT_THEME,
  TIMES_FONT_THEME,
  GEORGIA_FONT_THEME,
  CENTURY_GOTHIC_FONT_THEME,
  TREBUCHET_FONT_THEME,
  VERDANA_FONT_THEME,
];

/**
 * Map of font theme ID to font theme definition for O(1) lookup.
 */
const FONT_THEME_MAP = new Map<string, FontThemeDefinition>(
  BUILT_IN_FONT_THEMES.map((theme) => [theme.id, theme]),
);

// =============================================================================
// Font Theme Utilities
// =============================================================================

/**
 * Get a built-in font theme by ID.
 *
 * @param id - Font theme ID (e.g., 'office', 'arial')
 * @returns Font theme definition or undefined if not found
 */
export function getBuiltInFontTheme(id: string): FontThemeDefinition | undefined {
  return FONT_THEME_MAP.get(id);
}

/**
 * Get the effective fonts for a workbook.
 * If themeFontsId is set, uses that font theme.
 * Otherwise, uses the fonts from the full theme.
 *
 * @param themeId - The selected theme ID
 * @param themeFontsId - Optional font theme override ID
 * @returns Font pair (majorFont and minorFont)
 */
export function getEffectiveFonts(
  themeId: string,
  themeFontsId?: string,
): { majorFont: string; minorFont: string } {
  // Check for font theme override
  if (themeFontsId) {
    const fontTheme = FONT_THEME_MAP.get(themeFontsId);
    if (fontTheme) {
      return fontTheme.fonts;
    }
  }

  // Fall back to fonts from the full theme
  const theme = getBuiltInTheme(themeId) ?? OFFICE_THEME;
  return theme.fonts;
}
