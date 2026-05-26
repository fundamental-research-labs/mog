/**
 * Shared color parsing and manipulation utilities.
 *
 * Consolidates hex-to-RGB parsing, hex-to-RGBA string conversion,
 * and opacity application from across the canvas packages.
 */

// =============================================================================
// Core Hex Parsing
// =============================================================================

/**
 * Parse a hex color string into RGB components.
 *
 * Supports formats: `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `RGB`, `RRGGBB`.
 * Returns null if the string is not a recognized hex color.
 */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  // Try #RGB (3-char shorthand)
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m3) {
    return {
      r: parseInt(m3[1] + m3[1], 16),
      g: parseInt(m3[2] + m3[2], 16),
      b: parseInt(m3[3] + m3[3], 16),
    };
  }

  // Try #RRGGBB or #RRGGBBAA (6 or 8 char)
  const m6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (m6) {
    return {
      r: parseInt(m6[1], 16),
      g: parseInt(m6[2], 16),
      b: parseInt(m6[3], 16),
    };
  }

  return null;
}

// =============================================================================
// RGBA String Conversion
// =============================================================================

/**
 * Convert a hex color to an `rgba(r, g, b, a)` string.
 *
 * @param hex - Hex color string (#RGB, #RRGGBB, RRGGBB, etc.)
 * @param alpha - Alpha value 0-1 (default 1)
 * @returns `rgba(r, g, b, a)` string, or the original string if not a valid hex color
 */
export function hexToRgba(hex: string, alpha: number = 1): string {
  const parsed = parseHex(hex);
  if (!parsed) return hex;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

// =============================================================================
// Opacity Application
// =============================================================================

/**
 * Create a CSS color string with the given opacity.
 *
 * Handles hex colors (#RGB, #RRGGBB), `rgb()`, and `rgba()` inputs.
 * For opacity >= 1 the color is returned as-is; for opacity <= 0 returns transparent.
 *
 * @param color - Any CSS color string (hex, rgb, rgba)
 * @param opacity - Opacity value 0-1
 */
export function colorWithOpacity(color: string, opacity: number): string {
  if (opacity >= 1) return color;
  if (opacity <= 0) return 'rgba(0,0,0,0)';

  // Hex colors
  if (color.startsWith('#') || /^[0-9a-f]{3,8}$/i.test(color)) {
    const parsed = parseHex(color);
    if (parsed) {
      return `rgba(${parsed.r},${parsed.g},${parsed.b},${opacity})`;
    }
  }

  // Already rgba — replace the alpha component
  if (color.startsWith('rgba')) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `,${opacity})`);
  }

  // rgb() — convert to rgba()
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `,${opacity})`);
  }

  return color;
}
