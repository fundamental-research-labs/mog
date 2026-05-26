/**
 * Value Formatting
 *
 * Formats raw cell values for display. In the normal rendering path,
 * Rust pre-computes the formatted string (ViewportCell.formatted) and
 * this function simply returns it. The fallback path (for showFormulas
 * mode or when pre-formatted is unavailable) uses String(value).
 *
 * @module grid-renderer/cells/format-value
 */

import type { CultureInfo } from '@mog-sdk/contracts/culture';

/**
 * Format a cell value for display.
 *
 * @param value - Raw cell value (number, string, boolean, null, etc.)
 * @param format - Number format code (unused when preFormatted is provided)
 * @param culture - Culture info (unused when preFormatted is provided)
 * @param showFormulas - When true and formula is provided, display formula text
 * @param formula - Formula text (e.g., "=SUM(A1:A10)")
 * @param preFormatted - Pre-computed formatted string from Rust (ViewportCell.formatted)
 * @returns Formatted display string
 */
export function formatCellValue(
  value: unknown,
  _format: string | undefined,
  _culture: CultureInfo,
  showFormulas: boolean = false,
  formula?: string,
  preFormatted?: string,
): string {
  // In showFormulas mode, display the formula text if present
  if (showFormulas && formula) {
    return formula;
  }

  // Use pre-computed formatted string from Rust when available
  if (preFormatted !== undefined) return preFormatted;

  if (value === null || value === undefined) return '';

  // Boolean values display as TRUE/FALSE
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  // Fallback: should not happen in normal rendering flow
  // (ViewportCell.formatted is always populated by Rust)
  return String(value);
}
