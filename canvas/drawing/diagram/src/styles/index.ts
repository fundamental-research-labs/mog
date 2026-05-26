/**
 * Diagram Styles Module
 *
 * Provides styling system for Diagram diagrams including:
 * - Quick Styles (16 presets): Visual appearance of shapes
 * - Color Themes (36 themes): Color palettes and application strategies
 * - Effects (shadow, glow, bevel): Visual effects for shapes
 * - Validation: Ensure style data integrity
 *
 * @example
 * import {
 *   getQuickStyle,
 *   getColorTheme,
 *   generateNodeColors,
 *   applyQuickStyleToShape,
 *   createShadow,
 *   validateQuickStyle
 * } from '@mog/diagram-engine/styles';
 *
 * const style = getQuickStyle('subtle-effect');
 * const theme = getColorTheme('colorful-1');
 * const colors = generateNodeColors(theme, nodes);
 */

// =============================================================================
// Schema Definitions
// =============================================================================

export {
  COLOR_THEME_SCHEMA,
  QUICK_STYLE_SCHEMA,
  getColorThemeSchemaDefault,
  getColorThemeSchemaDefaults,
  getQuickStyleSchemaDefault,
  getQuickStyleSchemaDefaults,
  isColorThemeFieldRequired,
  isQuickStyleFieldRequired,
  type ColorThemeSchemaField,
  type QuickStyleSchemaField,
} from './quick-style-schema';

// =============================================================================
// Quick Styles
// =============================================================================

export {
  applyQuickStyleToShape,
  getAllQuickStyleIds,
  getQuickStyle,
  getQuickStylesByCategory,
  quickStyles,
} from './quick-styles';

// =============================================================================
// Color Themes
// =============================================================================

export {
  DEFAULT_ACCENT_COLORS,
  colorThemes,
  darkenColor,
  generateNodeColors,
  getAllColorThemeIds,
  getColorTheme,
  getColorThemesByCategory,
  // Color utilities (exported for testing and advanced use)
  hexToRgb,
  interpolateColors,
  lightenColor,
  rgbToHex,
} from './color-themes';

// =============================================================================
// Effects
// =============================================================================

export {
  BEVEL_TYPES,
  applyBevelToCanvas,
  applyEffectsToCanvas,
  clearFilterCache,
  createBevel,
  createGlow,
  createShadow,
  generateSVGBevelFilter,
  generateSVGFilterDefs,
  type BevelType,
} from './effects';

// =============================================================================
// Validation
// =============================================================================

export {
  isValidHexColor,
  validateColorTheme,
  validateColorThemeForGeneration,
  validateColorThemeSafe,
  validateQuickStyle,
  validateQuickStyleSafe,
  type ValidationResult,
} from './validation';
