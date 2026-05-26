/**
 * XLSX Parser Data Validation Runtime Functions
 *
 * Data validation utility functions for XLSX parsing.
 */

export function parseSqref(sqref: string): string[] {
  return sqref.trim().split(/\s+/).filter(Boolean);
}
