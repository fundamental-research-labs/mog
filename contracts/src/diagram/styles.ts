/**
 * Diagram Style Types
 *
 * Type definitions for Diagram quick styles and color themes.
 * These match Excel's built-in Diagram style options.
 *
 * Quick Styles: Define shape appearance (fill type, stroke, effects)
 * Color Themes: Define color palettes and how colors are applied to nodes
 */

import type { ShapeEffects } from './types';

// =============================================================================
// Quick Styles
// =============================================================================

/**
 * Quick Style preset definition.
 *
 * Quick styles define the visual appearance of shapes including:
 * - Fill type and opacity
 * - Stroke width and opacity
 * - Visual effects (shadow, glow, bevel, etc.)
 *
 * Excel provides 12 built-in quick styles across 4 categories.
 */
export interface QuickStyle {
  /** Unique style identifier */
  id: string;

  /** Display name shown in the style gallery */
  name: string;

  /** Style category for grouping in gallery */
  category: 'subtle' | 'moderate' | 'intense' | '3d';

  // --- Shape Fill ---

  /** Type of fill to apply to shapes */
  fillType: 'solid' | 'gradient' | 'pattern';

  /** Fill opacity (0 = transparent, 1 = opaque) */
  fillOpacity: number;

  // --- Shape Stroke ---

  /** Stroke/border width in pixels */
  strokeWidth: number;

  /** Stroke opacity (0 = transparent, 1 = opaque) */
  strokeOpacity: number;

  // --- Effects ---

  /** Visual effects to apply (shadow, glow, bevel, etc.) */
  effects: ShapeEffects;

  // --- Gallery ---

  /** Thumbnail image for the style gallery (base64 data URL or asset URL) */
  thumbnail: string;
}

// =============================================================================
// Color Themes
// =============================================================================

/**
 * Color theme definition.
 *
 * Color themes define:
 * - A palette of colors to use
 * - How colors are applied to nodes (strategy)
 * - Transparency levels
 *
 * Excel provides 32+ built-in color themes.
 */
export interface ColorTheme {
  /** Unique theme identifier */
  id: string;

  /** Display name shown in the theme gallery */
  name: string;

  /** Theme category for grouping in gallery */
  category: 'colorful' | 'accent' | 'transparent';

  /**
   * Color generation strategy - how colors are applied to nodes:
   *
   * - 'sequential': Each node gets the next color in the palette, cycling through
   * - 'by-level': Color is determined by hierarchy level (level 0 = color 1, etc.)
   * - 'gradient': Colors transition smoothly through the palette
   * - 'single': All nodes use the same color (for accent themes)
   */
  colorStrategy: 'sequential' | 'by-level' | 'gradient' | 'single';

  /**
   * Base colors for the theme.
   *
   * If empty, uses the document's theme accent colors.
   * Colors are CSS color strings (hex, rgb, etc.).
   */
  colors: string[];

  /**
   * Transparency level for shapes.
   *
   * 1 = fully opaque, 0 = fully transparent.
   * Used primarily for 'transparent' category themes.
   */
  opacity: number;
}

// =============================================================================
// Built-in Quick Style IDs
// =============================================================================

/**
 * Built-in quick style IDs matching Excel's Diagram Styles gallery.
 *
 * Excel provides exactly 14 presets organized into 2D and 3D groups:
 *
 * 2D Styles (5):
 * - simple-fill: Solid color fill, no effects
 * - subtle-line: Low-opacity fill with prominent stroke (White Outline)
 * - subtle-effect: Solid fill with light shadow
 * - moderate-effect: Gradient fill with medium shadow
 * - intense-effect: Gradient fill with strong shadow and glow
 *
 * 3D Styles (9):
 * - polished: Gradient fill with glow
 * - inset: Solid fill with inset shadow
 * - 3d-cartoon: Solid fill with bold stroke and soft-round bevel
 * - powder: Soft solid fill with diffuse shadow
 * - 3d-polished: Gradient fill with convex bevel and perspective
 * - 3d-flat-scene: Solid fill with relaxed bevel
 * - 3d-powder: Soft solid fill with circle bevel
 * - brick-scene: Solid fill with convex bevel and bottom shadow
 * - metallic-scene: Gradient fill with reflection
 * - sunrise-scene: Gradient fill with warm perspective shadow
 * - birds-eye-scene: Solid fill with top-down shadow
 *
 * Note: The category grouping ('subtle'/'moderate'/'intense'/'3d') is
 * used for gallery UI display. The OOXML quickStyle URIs map to these IDs.
 */
export const QUICK_STYLE_IDS = [
  // 2D styles
  'simple-fill',
  'subtle-effect',
  'subtle-line',
  'moderate-effect',
  'intense-effect',

  // 3D styles
  'polished',
  'inset',
  '3d-cartoon',
  'powder',
  '3d-polished',
  '3d-flat-scene',
  '3d-powder',
  'brick-scene',
  'metallic-scene',
  'sunrise-scene',
  'birds-eye-scene',
] as const;

// =============================================================================
// Built-in Color Theme IDs
// =============================================================================

/**
 * Built-in color theme IDs matching Excel's Change Colors gallery.
 *
 * Organized by section:
 * - Colorful (5): Uses multiple accent colors in sequence
 * - Primary theme colors (5): Uses document dk1/dk2/lt1/lt2 colors
 * - Accent variations (24): 6 accents x 4 variations each (light, outline, fill, gradient)
 * - Transparent (2): Semi-transparent variations
 *
 * Total: 36 built-in themes
 */
export const COLOR_THEME_IDS = [
  // Colorful themes (use multiple accent colors)
  'colorful-1',
  'colorful-2',
  'colorful-3',
  'colorful-4',
  'colorful-5',

  // Primary theme colors (5)
  'dark-1-outline',
  'light-1-outline',
  'dark-1-fill',
  'light-2-outline',
  'dark-2-fill',

  // Accent 1 variations
  'accent-1-light',
  'accent-1-outline',
  'accent-1-fill',
  'accent-1-gradient',

  // Accent 2 variations
  'accent-2-light',
  'accent-2-outline',
  'accent-2-fill',
  'accent-2-gradient',

  // Accent 3 variations
  'accent-3-light',
  'accent-3-outline',
  'accent-3-fill',
  'accent-3-gradient',

  // Accent 4 variations
  'accent-4-light',
  'accent-4-outline',
  'accent-4-fill',
  'accent-4-gradient',

  // Accent 5 variations
  'accent-5-light',
  'accent-5-outline',
  'accent-5-fill',
  'accent-5-gradient',

  // Accent 6 variations
  'accent-6-light',
  'accent-6-outline',
  'accent-6-fill',
  'accent-6-gradient',

  // Transparent themes
  'transparent-gradient',
  'transparent-outline',
] as const;

// =============================================================================
// Type Aliases
// =============================================================================

/**
 * Type representing valid quick style IDs.
 *
 * Union of all built-in quick style IDs.
 * Use this for type-safe style references.
 */
export type QuickStyleId = (typeof QUICK_STYLE_IDS)[number];

/**
 * Type representing valid color theme IDs.
 *
 * Includes all built-in theme IDs plus `| string` to allow custom themes.
 * Custom themes can be defined by users or imported from XLSX files.
 */
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number] | string;
