/**
 * Convert a 0-based column index to a column name: 0 → "A", 25 → "Z", 26 → "AA".
 * Single source of truth — replaces 3 duplicated copies across the codebase.
 */
export function colIndexToName(col: number): string {
  let name = '';
  let c = col;
  while (c >= 0) {
    name = String.fromCharCode(65 + (c % 26)) + name;
    c = Math.floor(c / 26) - 1;
  }
  return name;
}

/**
 * Convert 0-based row and column to a cell reference string: (0, 0) → "A1", (26, 2) → "C27".
 */
export function cellRef(row: number, col: number): string {
  return colIndexToName(col) + (row + 1);
}
