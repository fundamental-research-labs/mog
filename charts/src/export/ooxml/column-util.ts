/**
 * Column Letter Utility for OOXML Chart Export
 *
 * Converts 0-based column indices to Excel column letters (A, B, ..., Z, AA, AB, ...).
 * Replaces the unsafe `String.fromCharCode(66 + index)` pattern that overflows for index >= 25.
 *
 * Pure function - no side effects.
 */

/**
 * Convert a 0-based column index to an Excel column letter (A, B, ..., Z, AA, AB, ...).
 *
 * @param index - 0-based column index (0 = A, 1 = B, 25 = Z, 26 = AA, ...)
 * @returns Excel-style column letter string
 */
export function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
