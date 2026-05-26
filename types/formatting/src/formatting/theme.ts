/**
 * Theme Contracts
 *
 * Type definitions and utilities for workbook themes.
 * Themes define color palettes and font pairs that cells can reference.
 *
 * Issue 4: Page Layout - Themes
 */

// ============================================================================
// Theme Color Slots (OOXML Standard)
// ============================================================================

/**
 * Theme color slots following the OOXML standard.
 * These 12 colors form the foundation of any theme.
 */
export interface ThemeColors {
  /** Primary dark color - typically black/near-black for text */
  dark1: string;
  /** Primary light color - typically white for backgrounds */
  light1: string;
  /** Secondary dark color */
  dark2: string;
  /** Secondary light color */
  light2: string;
  /** Accent color 1 - primary accent (blue in Office default) */
  accent1: string;
  /** Accent color 2 - typically orange */
  accent2: string;
  /** Accent color 3 - typically gray */
  accent3: string;
  /** Accent color 4 - typically yellow/gold */
  accent4: string;
  /** Accent color 5 - typically blue-gray */
  accent5: string;
  /** Accent color 6 - typically green */
  accent6: string;
  /** Hyperlink color */
  hyperlink: string;
  /** Followed hyperlink color */
  followedHyperlink: string;
}

/**
 * All valid theme color slot names
 */
export type ThemeColorSlot = keyof ThemeColors;

// ============================================================================
// Theme Fonts
// ============================================================================

/**
 * Theme font pair - major (headings) and minor (body) fonts.
 */
export interface ThemeFonts {
  /** Font for headings (e.g., 'Calibri Light') */
  majorFont: string;
  /** Font for body text (e.g., 'Calibri') */
  minorFont: string;
}

/**
 * Standalone font theme definition (separate from full theme).
 * Used for the Fonts dropdown in Page Layout to select font pair
 * independently from the color theme.
 *
 * Theme font UI
 */
export interface FontThemeDefinition {
  /** Unique identifier (e.g., 'office', 'arial') */
  id: string;
  /** Display name shown in UI (e.g., 'Office', 'Arial') */
  name: string;
  /** Font pair */
  fonts: ThemeFonts;
  /** True for built-in font themes */
  builtIn: boolean;
}

// ============================================================================
// Theme Definition
// ============================================================================

/**
 * Complete theme definition including colors and fonts.
 */
export interface ThemeDefinition {
  /** Unique theme identifier (e.g., 'office', 'slice', 'custom-abc123') */
  id: string;
  /** Display name shown in UI (e.g., 'Office', 'Slice') */
  name: string;
  /** Theme color palette */
  colors: ThemeColors;
  /** Theme font pair */
  fonts: ThemeFonts;
  /** True for built-in themes, false for user-created */
  builtIn: boolean;
}

// ============================================================================
// Color Value Types
// ============================================================================

/**
 * Color value that can be either absolute hex or a theme reference.
 *
 * Formats:
 * - Absolute: '#rrggbb' or '#rrggbbaa'
 * - Theme reference: 'theme:slot' (e.g., 'theme:accent1')
 * - Theme with tint: 'theme:slot:tint' (e.g., 'theme:accent1:0.4' for 40% lighter)
 *
 * @example
 * '#4472c4'           // Absolute blue
 * 'theme:accent1'     // Theme's accent1 color
 * 'theme:accent1:0.4' // Theme's accent1, 40% tinted toward white
 * 'theme:accent1:-0.25' // Theme's accent1, 25% shaded toward black
 */
export type ColorValue = string;

/**
 * Parsed theme color reference
 */
export interface ParsedThemeColor {
  /** The theme color slot (e.g., 'accent1', 'dark1') */
  slot: ThemeColorSlot;
  /** Tint value: positive = lighter (toward white), negative = darker (toward black) */
  tint?: number;
}
