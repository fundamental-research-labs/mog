/**
 * Auto-Outline Module
 *
 * Auto-detect and create groups based on formula patterns.
 * Analyzes formulas to detect summary rows/columns and creates groups.
 * All group operations delegate to ComputeBridge (Rust compute core).
 *
 * Stream O: Grouping/Outline Implementation
 *
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';

import type { DocumentContext } from '../../context/types';

import type { SubtotalsCellAccessor } from './types';

import { getGroups } from './queries';
import { groupRows } from './row-groups';

// =============================================================================
// Auto-Outline
// =============================================================================

/**
 * Convert column index to Excel letter (0 = A, 1 = B, etc.).
 * Local helper for auto-outline pattern matching.
 */
function colToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Auto-outline based on formula patterns.
 * Analyzes formulas to detect summary rows/columns and creates groups.
 *
 * This is a best-effort operation that looks for patterns like:
 * - Rows with SUM/SUBTOTAL formulas referencing adjacent rows
 * - Rows with AVERAGE formulas spanning multiple rows
 *
 * @param ctx - Store context
 * @param cellAccessor - Cell accessor
 * @param sheetId - Sheet ID
 * @param range - Range to analyze
 * @param origin - Source of the change
 * @returns Promise of number of groups created
 */
export async function autoOutline(
  ctx: DocumentContext,
  cellAccessor: SubtotalsCellAccessor,
  sheetId: SheetId,
  range: CellRange,
  origin: StructureChangeSource = 'user',
): Promise<number> {
  // Pattern: Look for rows with formulas that reference ranges above them
  // These are likely summary rows

  let groupsCreated = 0;

  // Scan for summary row patterns
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const rawValue = cellAccessor.getCellRawValue(sheetId, row, col);

      if (typeof rawValue !== 'string' || !rawValue.startsWith('=')) {
        continue;
      }

      const formula = rawValue.toUpperCase();

      // Check for aggregate functions
      const hasAggregate = /\b(SUM|SUBTOTAL|AVERAGE|COUNT|MAX|MIN|PRODUCT)\s*\(/.test(formula);
      if (!hasAggregate) {
        continue;
      }

      // Try to extract range reference (simple pattern: COL#:COL#)
      const colLetter = colToLetter(col);
      const rangePattern = new RegExp(`${colLetter}(\\d+):${colLetter}(\\d+)`, 'i');
      const match = formula.match(rangePattern);

      if (match) {
        const refStartRow = parseInt(match[1], 10) - 1; // Convert to 0-indexed
        const refEndRow = parseInt(match[2], 10) - 1;

        // Only create group if the formula references rows above (within range)
        if (refStartRow >= range.startRow && refEndRow < row && refEndRow >= refStartRow) {
          // Check if a group already exists for this exact range
          const existingGroups = await getGroups(ctx, sheetId, 'row');
          const alreadyGrouped = existingGroups.some(
            (g) => g.start === refStartRow && g.end === row,
          );

          if (!alreadyGrouped) {
            // Create group from detail rows to summary row (fire-and-forget)
            groupRows(ctx, sheetId, refStartRow, row, origin);
            groupsCreated++;
          }
        }
      }
    }
  }

  return groupsCreated;
}
