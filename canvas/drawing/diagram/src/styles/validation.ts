/**
 * Diagram Style Validation
 *
 * Provides validation functions for QuickStyle and ColorTheme objects.
 * Used to ensure style data integrity before use in rendering.
 *
 * Separation of Concerns:
 * - validateQuickStyle: Full validation for style definitions
 * - validateColorTheme: Full validation for theme definitions
 * - validateColorThemeForGeneration: Minimal validation for color generation
 *
 * @see contracts/src/diagram/styles.ts for type definitions
 */

import type { ColorTheme, QuickStyle } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Hex Color Validation
// =============================================================================

/**
 * Regex for validating hex colors.
 * Matches: #RRGGBB, #rrggbb, RRGGBB, rrggbb (6 hex characters, optional #)
 */
const HEX_COLOR_REGEX = /^#?([a-fA-F0-9]{6})$/;

/**
 * Check if a string is a valid hex color.
 *
 * @param color - The color string to validate
 * @returns true if valid hex color
 */
export function isValidHexColor(color: string): boolean {
  return HEX_COLOR_REGEX.test(color);
}

// =============================================================================
// QuickStyle Validation
// =============================================================================

/**
 * Validate a QuickStyle object.
 *
 * Checks:
 * - id is non-empty
 * - name is non-empty
 * - fillOpacity is between 0 and 1
 * - strokeOpacity is between 0 and 1
 * - strokeWidth is non-negative
 *
 * @param style - The QuickStyle to validate
 * @throws Error if validation fails
 *
 * @example
 * try {
 *   validateQuickStyle(style);
 *   // Style is valid, safe to use
 * } catch (error) {
 *   console.error('Invalid style:', error.message);
 * }
 */
export function validateQuickStyle(style: QuickStyle): void {
  if (!style.id || style.id.trim() === '') {
    throw new Error('QuickStyle must have a non-empty id');
  }

  if (!style.name || style.name.trim() === '') {
    throw new Error('QuickStyle must have a non-empty name');
  }

  if (typeof style.fillOpacity !== 'number' || style.fillOpacity < 0 || style.fillOpacity > 1) {
    throw new Error('fillOpacity must be a number between 0 and 1');
  }

  if (
    typeof style.strokeOpacity !== 'number' ||
    style.strokeOpacity < 0 ||
    style.strokeOpacity > 1
  ) {
    throw new Error('strokeOpacity must be a number between 0 and 1');
  }

  if (typeof style.strokeWidth !== 'number' || style.strokeWidth < 0) {
    throw new Error('strokeWidth must be a non-negative number');
  }

  // Validate category
  const validCategories = ['subtle', 'moderate', 'intense', '3d'];
  if (!validCategories.includes(style.category)) {
    throw new Error(
      `Invalid category: ${style.category}. Must be one of: ${validCategories.join(', ')}`,
    );
  }

  // Validate fillType
  const validFillTypes = ['solid', 'gradient', 'pattern'];
  if (!validFillTypes.includes(style.fillType)) {
    throw new Error(
      `Invalid fillType: ${style.fillType}. Must be one of: ${validFillTypes.join(', ')}`,
    );
  }

  // Validate effects
  validateEffects(style.effects);
}

/**
 * Validate effect values are within valid ranges.
 *
 * Checks:
 * - Shadow: opacity 0-1, blur >= 0
 * - Glow: opacity 0-1, radius >= 0
 * - Bevel: width >= 0, height >= 0
 * - Reflection: opacity 0-1, blur >= 0, size 0-1
 *
 * @param effects - The ShapeEffects to validate
 * @throws Error if any effect value is out of range
 */
function validateEffects(effects: QuickStyle['effects']): void {
  if (effects.shadow) {
    const s = effects.shadow;
    if (typeof s.opacity !== 'number' || s.opacity < 0 || s.opacity > 1) {
      throw new Error('shadow.opacity must be a number between 0 and 1');
    }
    if (typeof s.blur !== 'number' || s.blur < 0) {
      throw new Error('shadow.blur must be a non-negative number');
    }
  }

  if (effects.glow) {
    const g = effects.glow;
    if (typeof g.opacity !== 'number' || g.opacity < 0 || g.opacity > 1) {
      throw new Error('glow.opacity must be a number between 0 and 1');
    }
    if (typeof g.radius !== 'number' || g.radius < 0) {
      throw new Error('glow.radius must be a non-negative number');
    }
  }

  if (effects.bevel) {
    const b = effects.bevel;
    if (typeof b.width !== 'number' || b.width < 0) {
      throw new Error('bevel.width must be a non-negative number');
    }
    if (typeof b.height !== 'number' || b.height < 0) {
      throw new Error('bevel.height must be a non-negative number');
    }
  }

  if (effects.reflection) {
    const r = effects.reflection;
    if (typeof r.opacity !== 'number' || r.opacity < 0 || r.opacity > 1) {
      throw new Error('reflection.opacity must be a number between 0 and 1');
    }
    if (typeof r.blur !== 'number' || r.blur < 0) {
      throw new Error('reflection.blur must be a non-negative number');
    }
    if (typeof r.size !== 'number' || r.size < 0 || r.size > 1) {
      throw new Error('reflection.size must be a number between 0 and 1');
    }
  }
}

// =============================================================================
// ColorTheme Validation
// =============================================================================

/**
 * Validate a ColorTheme object.
 *
 * Checks:
 * - id is non-empty
 * - name is non-empty
 * - colors array is not empty
 * - all colors are valid hex colors
 * - opacity is between 0 and 1
 *
 * @param theme - The ColorTheme to validate
 * @throws Error if validation fails
 *
 * @example
 * try {
 *   validateColorTheme(theme);
 *   // Theme is valid, safe to use
 * } catch (error) {
 *   console.error('Invalid theme:', error.message);
 * }
 */
export function validateColorTheme(theme: ColorTheme): void {
  if (!theme.id || theme.id.trim() === '') {
    throw new Error('ColorTheme must have a non-empty id');
  }

  if (!theme.name || theme.name.trim() === '') {
    throw new Error('ColorTheme must have a non-empty name');
  }

  if (!Array.isArray(theme.colors) || theme.colors.length === 0) {
    throw new Error('ColorTheme must have at least one color');
  }

  // Validate all colors are valid hex
  theme.colors.forEach((color, index) => {
    if (!isValidHexColor(color)) {
      throw new Error(`Invalid hex color at index ${index}: ${color}`);
    }
  });

  if (typeof theme.opacity !== 'number' || theme.opacity < 0 || theme.opacity > 1) {
    throw new Error('opacity must be a number between 0 and 1');
  }

  // Validate category
  const validCategories = ['colorful', 'accent', 'transparent'];
  if (!validCategories.includes(theme.category)) {
    throw new Error(
      `Invalid category: ${theme.category}. Must be one of: ${validCategories.join(', ')}`,
    );
  }

  // Validate colorStrategy
  const validStrategies = ['sequential', 'by-level', 'gradient', 'single'];
  if (!validStrategies.includes(theme.colorStrategy)) {
    throw new Error(
      `Invalid colorStrategy: ${theme.colorStrategy}. Must be one of: ${validStrategies.join(', ')}`,
    );
  }
}

/**
 * Validate that a color theme is ready for use in generation functions.
 *
 * This is a minimal validation focused on the requirements for
 * generateNodeColors() - primarily ensuring colors are available
 * and valid. Use validateColorTheme() for full validation.
 *
 * Checks:
 * - colors array is not empty
 * - all colors are valid hex colors
 *
 * @param theme - The ColorTheme to validate for generation
 * @throws Error if validation fails
 *
 * @example
 * validateColorThemeForGeneration(theme);
 * const colors = generateNodeColors(theme, nodes);
 */
export function validateColorThemeForGeneration(theme: ColorTheme): void {
  if (!Array.isArray(theme.colors) || theme.colors.length === 0) {
    throw new Error('Color theme must have at least one color for generation');
  }

  // Validate all colors are valid hex
  theme.colors.forEach((color) => {
    if (!isValidHexColor(color)) {
      throw new Error(`Invalid hex color in theme: ${color}`);
    }
  });
}

// =============================================================================
// Validation Result Types
// =============================================================================

/**
 * Result of a validation check with detailed error information.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error messages if validation failed */
  errors: string[];
}

/**
 * Validate a QuickStyle and return a result object instead of throwing.
 *
 * @param style - The QuickStyle to validate
 * @returns ValidationResult with valid flag and any errors
 */
export function validateQuickStyleSafe(style: QuickStyle): ValidationResult {
  const errors: string[] = [];

  if (!style.id || style.id.trim() === '') {
    errors.push('QuickStyle must have a non-empty id');
  }

  if (!style.name || style.name.trim() === '') {
    errors.push('QuickStyle must have a non-empty name');
  }

  if (typeof style.fillOpacity !== 'number' || style.fillOpacity < 0 || style.fillOpacity > 1) {
    errors.push('fillOpacity must be a number between 0 and 1');
  }

  if (
    typeof style.strokeOpacity !== 'number' ||
    style.strokeOpacity < 0 ||
    style.strokeOpacity > 1
  ) {
    errors.push('strokeOpacity must be a number between 0 and 1');
  }

  if (typeof style.strokeWidth !== 'number' || style.strokeWidth < 0) {
    errors.push('strokeWidth must be a non-negative number');
  }

  const validCategories = ['subtle', 'moderate', 'intense', '3d'];
  if (!validCategories.includes(style.category)) {
    errors.push(`Invalid category: ${style.category}`);
  }

  const validFillTypes = ['solid', 'gradient', 'pattern'];
  if (!validFillTypes.includes(style.fillType)) {
    errors.push(`Invalid fillType: ${style.fillType}`);
  }

  // Validate effects
  validateEffectsSafe(style.effects, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate effect values (safe version that collects errors).
 */
function validateEffectsSafe(effects: QuickStyle['effects'], errors: string[]): void {
  if (effects.shadow) {
    const s = effects.shadow;
    if (typeof s.opacity !== 'number' || s.opacity < 0 || s.opacity > 1) {
      errors.push('shadow.opacity must be a number between 0 and 1');
    }
    if (typeof s.blur !== 'number' || s.blur < 0) {
      errors.push('shadow.blur must be a non-negative number');
    }
  }

  if (effects.glow) {
    const g = effects.glow;
    if (typeof g.opacity !== 'number' || g.opacity < 0 || g.opacity > 1) {
      errors.push('glow.opacity must be a number between 0 and 1');
    }
    if (typeof g.radius !== 'number' || g.radius < 0) {
      errors.push('glow.radius must be a non-negative number');
    }
  }

  if (effects.bevel) {
    const b = effects.bevel;
    if (typeof b.width !== 'number' || b.width < 0) {
      errors.push('bevel.width must be a non-negative number');
    }
    if (typeof b.height !== 'number' || b.height < 0) {
      errors.push('bevel.height must be a non-negative number');
    }
  }

  if (effects.reflection) {
    const r = effects.reflection;
    if (typeof r.opacity !== 'number' || r.opacity < 0 || r.opacity > 1) {
      errors.push('reflection.opacity must be a number between 0 and 1');
    }
    if (typeof r.blur !== 'number' || r.blur < 0) {
      errors.push('reflection.blur must be a non-negative number');
    }
    if (typeof r.size !== 'number' || r.size < 0 || r.size > 1) {
      errors.push('reflection.size must be a number between 0 and 1');
    }
  }
}

/**
 * Validate a ColorTheme and return a result object instead of throwing.
 *
 * @param theme - The ColorTheme to validate
 * @returns ValidationResult with valid flag and any errors
 */
export function validateColorThemeSafe(theme: ColorTheme): ValidationResult {
  const errors: string[] = [];

  if (!theme.id || theme.id.trim() === '') {
    errors.push('ColorTheme must have a non-empty id');
  }

  if (!theme.name || theme.name.trim() === '') {
    errors.push('ColorTheme must have a non-empty name');
  }

  if (!Array.isArray(theme.colors) || theme.colors.length === 0) {
    errors.push('ColorTheme must have at least one color');
  } else {
    theme.colors.forEach((color, index) => {
      if (!isValidHexColor(color)) {
        errors.push(`Invalid hex color at index ${index}: ${color}`);
      }
    });
  }

  if (typeof theme.opacity !== 'number' || theme.opacity < 0 || theme.opacity > 1) {
    errors.push('opacity must be a number between 0 and 1');
  }

  const validCategories = ['colorful', 'accent', 'transparent'];
  if (!validCategories.includes(theme.category)) {
    errors.push(`Invalid category: ${theme.category}`);
  }

  const validStrategies = ['sequential', 'by-level', 'gradient', 'single'];
  if (!validStrategies.includes(theme.colorStrategy)) {
    errors.push(`Invalid colorStrategy: ${theme.colorStrategy}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
