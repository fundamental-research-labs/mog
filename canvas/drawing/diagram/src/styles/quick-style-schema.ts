/**
 * Diagram Style Schema Definitions
 *
 * Schema-driven definitions for QuickStyle and ColorTheme data structures.
 * These schemas follow the FieldDef pattern from schema-types.ts for consistency.
 *
 * NOTE: These schemas are primarily for DOCUMENTATION and validation purposes
 * since QuickStyle and ColorTheme data are stored as plain objects, not Yjs structures.
 * The FieldDef pattern ensures consistency with other schema definitions in the codebase.
 *
 * @see contracts/src/store/schema-types.ts for FieldDef structure
 * @see contracts/src/diagram/styles.ts for QuickStyle and ColorTheme types
 */

import type { Schema } from '@mog-sdk/contracts/store';

// =============================================================================
// QuickStyle Schema
// =============================================================================

/**
 * QuickStyle schema following schema-driven pattern.
 *
 * Quick styles define the visual appearance of shapes including:
 * - Fill type and opacity
 * - Stroke width and opacity
 * - Visual effects (shadow, glow, bevel, etc.)
 *
 * Excel provides 16 built-in quick styles across 4 categories:
 * - subtle (3): Minimal effects, clean appearance
 * - moderate (3): Balanced effects
 * - intense (3): Strong visual effects
 * - 3d (7): Three-dimensional appearance
 */
export const QUICK_STYLE_SCHEMA = {
  /**
   * Unique style identifier (e.g., 'subtle-effect', '3d-cartoon')
   */
  id: {
    type: 'primitive',
    default: '',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Display name shown in the style gallery
   */
  name: {
    type: 'primitive',
    default: '',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Style category for grouping in gallery
   * Values: 'subtle' | 'moderate' | 'intense' | '3d'
   */
  category: {
    type: 'primitive',
    default: 'subtle',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Type of fill to apply to shapes
   * Values: 'solid' | 'gradient' | 'pattern'
   */
  fillType: {
    type: 'primitive',
    default: 'solid',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Fill opacity (0 = transparent, 1 = opaque)
   */
  fillOpacity: {
    type: 'primitive',
    default: 1,
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Stroke/border width in pixels
   */
  strokeWidth: {
    type: 'primitive',
    default: 1,
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Stroke opacity (0 = transparent, 1 = opaque)
   */
  strokeOpacity: {
    type: 'primitive',
    default: 1,
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Visual effects to apply (shadow, glow, bevel, etc.)
   * Deep copied since it contains nested objects
   */
  effects: {
    type: 'primitive',
    default: {},
    required: false,
    copy: 'deep',
    lazyInit: false,
  },

  /**
   * Thumbnail image for the style gallery (base64 data URL or asset URL)
   */
  thumbnail: {
    type: 'primitive',
    default: '',
    required: false,
    copy: 'shallow',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// ColorTheme Schema
// =============================================================================

/**
 * ColorTheme schema following schema-driven pattern.
 *
 * Color themes define:
 * - A palette of colors to use
 * - How colors are applied to nodes (strategy)
 * - Transparency levels
 *
 * Excel provides 36 built-in color themes across 3 categories:
 * - colorful (5): Uses multiple accent colors in sequence
 * - accent (29): Single accent color with variations (5 primary + 24 per-accent)
 * - transparent (2): Semi-transparent variations
 */
export const COLOR_THEME_SCHEMA = {
  /**
   * Unique theme identifier (e.g., 'colorful-1', 'accent-1-light')
   */
  id: {
    type: 'primitive',
    default: '',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Display name shown in the theme gallery
   */
  name: {
    type: 'primitive',
    default: '',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Theme category for grouping in gallery
   * Values: 'colorful' | 'accent' | 'transparent'
   */
  category: {
    type: 'primitive',
    default: 'colorful',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Color generation strategy - how colors are applied to nodes:
   * - 'sequential': Each node gets the next color in the palette, cycling through
   * - 'by-level': Color is determined by hierarchy level (level 0 = color 1, etc.)
   * - 'gradient': Colors transition smoothly through the palette
   * - 'single': All nodes use the same color (for accent themes)
   */
  colorStrategy: {
    type: 'primitive',
    default: 'sequential',
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },

  /**
   * Base colors for the theme.
   * If empty, uses the document's theme accent colors.
   * Colors are CSS color strings (hex format preferred).
   * Deep copied since it's an array
   */
  colors: {
    type: 'primitive',
    default: [],
    required: true,
    copy: 'deep',
    lazyInit: false,
  },

  /**
   * Transparency level for shapes.
   * 1 = fully opaque, 0 = fully transparent.
   * Used primarily for 'transparent' category themes.
   */
  opacity: {
    type: 'primitive',
    default: 1,
    required: true,
    copy: 'shallow',
    lazyInit: false,
  },
} as const satisfies Schema;

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Type for QuickStyle schema field names
 */
export type QuickStyleSchemaField = keyof typeof QUICK_STYLE_SCHEMA;

/**
 * Type for ColorTheme schema field names
 */
export type ColorThemeSchemaField = keyof typeof COLOR_THEME_SCHEMA;

// =============================================================================
// Schema Utility Functions
// =============================================================================

/**
 * Get the default value for a QuickStyle schema field.
 *
 * @param field - The field name
 * @returns The default value, or undefined if no default
 */
export function getQuickStyleSchemaDefault(field: QuickStyleSchemaField): unknown {
  const def = QUICK_STYLE_SCHEMA[field];
  return 'default' in def ? def.default : undefined;
}

/**
 * Get the default value for a ColorTheme schema field.
 *
 * @param field - The field name
 * @returns The default value, or undefined if no default
 */
export function getColorThemeSchemaDefault(field: ColorThemeSchemaField): unknown {
  const def = COLOR_THEME_SCHEMA[field];
  return 'default' in def ? def.default : undefined;
}

/**
 * Get all default values for QuickStyle schema fields.
 *
 * @returns Record of field names to default values
 */
export function getQuickStyleSchemaDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(QUICK_STYLE_SCHEMA)) {
    if ('default' in def && def.default !== undefined) {
      defaults[key] = def.default;
    }
  }
  return defaults;
}

/**
 * Get all default values for ColorTheme schema fields.
 *
 * @returns Record of field names to default values
 */
export function getColorThemeSchemaDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(COLOR_THEME_SCHEMA)) {
    if ('default' in def && def.default !== undefined) {
      defaults[key] = def.default;
    }
  }
  return defaults;
}

/**
 * Check if a QuickStyle schema field is required.
 *
 * @param field - The field name
 * @returns true if the field is required
 */
export function isQuickStyleFieldRequired(field: QuickStyleSchemaField): boolean {
  return QUICK_STYLE_SCHEMA[field].required;
}

/**
 * Check if a ColorTheme schema field is required.
 *
 * @param field - The field name
 * @returns true if the field is required
 */
export function isColorThemeFieldRequired(field: ColorThemeSchemaField): boolean {
  return COLOR_THEME_SCHEMA[field].required;
}
