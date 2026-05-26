/**
 * Cursor Position Helpers
 *
 * Pure functions for calculating text cursor position from click coordinates.
 * Used when double-clicking to edit a cell to position the cursor at the click location.
 *
 * @see use-grid-mouse.ts - Main hook that uses these helpers
 */

// =============================================================================
// Cursor Position Calculation
// =============================================================================

/**
 * Calculate cursor position in text from click X coordinate.
 *
 * Uses a linear scan approach to find the character boundary closest to the
 * click position by measuring text width. This provides accurate cursor
 * positioning even with variable-width fonts.
 *
 * @param clickXInCell - X position of click relative to cell content start (after padding)
 * @param text - The cell's display text
 * @param font - Canvas font string for measurement (e.g., "14px Arial")
 * @returns Character index for cursor position (0 = before first char, text.length = after last char)
 *
 * @example
 * ```ts
 * // Click in the middle of "Hello World"
 * const cursorPos = calculateCursorPosition(35, "Hello World", "14px Arial");
 * // Returns ~5 (between "Hello" and " ")
 *
 * // Click at the beginning
 * const cursorPos = calculateCursorPosition(0, "Hello", "14px Arial");
 * // Returns 0
 *
 * // Click past the end
 * const cursorPos = calculateCursorPosition(1000, "Hello", "14px Arial");
 * // Returns 5 (text.length)
 * ```
 */
export function calculateCursorPosition(clickXInCell: number, text: string, font: string): number {
  // Handle edge cases
  if (!text || text.length === 0) return 0;
  if (clickXInCell <= 0) return 0;

  // Get measurement context
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length;
  ctx.font = font;

  // Measure full text width
  const fullWidth = ctx.measureText(text).width;
  if (clickXInCell >= fullWidth) return text.length;

  // Find the character position where click occurred
  // Use linear scan with early exit (most double-clicks are near the cursor position)
  let pos = 0;
  let prevWidth = 0;

  for (let i = 1; i <= text.length; i++) {
    const width = ctx.measureText(text.slice(0, i)).width;

    if (width >= clickXInCell) {
      // Click is between character (i-1) and (i)
      // Choose the closer one based on midpoint
      const midpoint = (prevWidth + width) / 2;
      pos = clickXInCell < midpoint ? i - 1 : i;
      break;
    }

    prevWidth = width;
    pos = i;
  }

  return pos;
}

/**
 * Interface for text measurement context.
 * Used for dependency injection in testing.
 */
export interface TextMeasurer {
  measureText(text: string): { width: number };
  font: string;
}

/**
 * Calculate cursor position with an injected text measurer.
 * This variant allows for easier unit testing without requiring DOM canvas.
 *
 * @param clickXInCell - X position of click relative to cell content start
 * @param text - The cell's display text
 * @param measurer - Text measurement interface
 * @returns Character index for cursor position
 */
export function calculateCursorPositionWithMeasurer(
  clickXInCell: number,
  text: string,
  measurer: TextMeasurer,
): number {
  // Handle edge cases
  if (!text || text.length === 0) return 0;
  if (clickXInCell <= 0) return 0;

  // Measure full text width
  const fullWidth = measurer.measureText(text).width;
  if (clickXInCell >= fullWidth) return text.length;

  // Find the character position where click occurred
  let pos = 0;
  let prevWidth = 0;

  for (let i = 1; i <= text.length; i++) {
    const width = measurer.measureText(text.slice(0, i)).width;

    if (width >= clickXInCell) {
      // Click is between character (i-1) and (i)
      // Choose the closer one based on midpoint
      const midpoint = (prevWidth + width) / 2;
      pos = clickXInCell < midpoint ? i - 1 : i;
      break;
    }

    prevWidth = width;
    pos = i;
  }

  return pos;
}
