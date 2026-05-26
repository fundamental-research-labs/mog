/**
 * Recent Colors Utility
 *
 * Tracks and persists recently used colors for fill, font, and border pickers.
 * Colors are stored in localStorage and limited to the 10 most recent per type.
 *
 * Usage:
 * - getRecentColors('fill') - Get recent fill colors
 * - addRecentColor('fill', '#FF0000') - Add a color to recent fill colors
 * - clearRecentColors('fill') - Clear recent fill colors
 *
 * The ColorPicker component consumes these utilities to display recent colors
 * and track new color selections.
 *
 * @see ColorPicker.tsx for UI integration
 */

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for recent fill colors */
const RECENT_FILL_COLORS_KEY = 'spreadsheet:recentFillColors';

/** LocalStorage key for recent font colors */
const RECENT_FONT_COLORS_KEY = 'spreadsheet:recentFontColors';

/** LocalStorage key for recent border colors */
const RECENT_BORDER_COLORS_KEY = 'spreadsheet:recentBorderColors';

/** Maximum number of recent colors to store per type */
const MAX_RECENT_COLORS = 10;

// =============================================================================
// Types
// =============================================================================

/**
 * Color type for categorizing recent colors.
 */
export type ColorType = 'fill' | 'font' | 'border';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the localStorage key for a color type.
 */
function getStorageKey(type: ColorType): string {
  switch (type) {
    case 'fill':
      return RECENT_FILL_COLORS_KEY;
    case 'font':
      return RECENT_FONT_COLORS_KEY;
    case 'border':
      return RECENT_BORDER_COLORS_KEY;
  }
}

/**
 * Normalize a color string to uppercase hex format.
 * This ensures consistent comparison regardless of input format.
 *
 * @param color - Color string (e.g., '#ff0000', 'FF0000', '#FF0000')
 * @returns Uppercase hex color with # prefix
 */
function normalizeColor(color: string): string {
  const trimmed = color.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return withHash.toUpperCase();
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get recent colors for a specific type.
 *
 * @param type - Color type ('fill', 'font', or 'border')
 * @returns Array of recent color hex strings, most recent first
 *
 * @example
 * const recentFillColors = getRecentColors('fill');
 * // Returns: ['#FF0000', '#00FF00', '#0000FF', ...]
 */
export function getRecentColors(type: ColorType): string[] {
  try {
    const key = getStorageKey(type);
    const stored = localStorage.getItem(key);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Validate each color is a string
    return parsed.filter((c): c is string => typeof c === 'string');
  } catch {
    // localStorage might not be available (SSR, private browsing, etc.)
    return [];
  }
}

/**
 * Add a color to recent colors for a specific type.
 *
 * The color is added to the front of the list. If the color already exists,
 * it's moved to the front. The list is trimmed to MAX_RECENT_COLORS.
 *
 * @param type - Color type ('fill', 'font', or 'border')
 * @param color - Color hex string to add
 *
 * @example
 * addRecentColor('fill', '#FF0000');
 */
export function addRecentColor(type: ColorType, color: string): void {
  try {
    const key = getStorageKey(type);
    const normalized = normalizeColor(color);

    // Get existing colors, excluding the new one (to avoid duplicates)
    const existing = getRecentColors(type).filter((c) => normalizeColor(c) !== normalized);

    // Add new color at the front and trim to max
    const updated = [normalized, ...existing].slice(0, MAX_RECENT_COLORS);

    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // localStorage might not be available - silently fail
  }
}

/**
 * Clear all recent colors for a specific type.
 *
 * @param type - Color type ('fill', 'font', or 'border')
 *
 * @example
 * clearRecentColors('fill');
 */
export function clearRecentColors(type: ColorType): void {
  try {
    const key = getStorageKey(type);
    localStorage.removeItem(key);
  } catch {
    // localStorage might not be available - silently fail
  }
}

/**
 * Clear all recent colors for all types.
 *
 * @example
 * clearAllRecentColors();
 */
export function clearAllRecentColors(): void {
  clearRecentColors('fill');
  clearRecentColors('font');
  clearRecentColors('border');
}
