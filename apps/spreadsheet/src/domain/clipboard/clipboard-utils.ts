/**
 * Clipboard Utility Functions
 *
 * Pure utility functions for clipboard operations.
 * Moved from systems/shared/types.ts to maintain domain/ purity.
 */

import type { CellCoord } from '@mog-sdk/contracts/rendering';

// Re-export normalizeRange from contracts (canonical source)
export { normalizeRange } from '@mog/spreadsheet-utils/range';

/**
 * Parse a cell key string ("row,col") back to CellCoord.
 */
export function parseCellKey(key: string): CellCoord {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}
