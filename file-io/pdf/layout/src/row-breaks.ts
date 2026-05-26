/**
 * row-breaks.ts — Row break calculation with merge awareness
 *
 * Calculates where horizontal (row) page breaks should occur,
 * respecting merged regions, manual page breaks, and hidden rows.
 */

import type { ContentMeasurer, LayoutWarning, MergedRegion, RowBreakInfo } from './types';

/**
 * Parameters for row break calculation.
 */
export interface RowBreakParams {
  startRow: number;
  endRow: number;
  contentHeight: number;
  measurer: ContentMeasurer;
  manualBreaks: Set<number>;
  mergedRegions: MergedRegion[];
  repeatRows?: [number, number];
}

/**
 * Result of row break calculation.
 */
export interface RowBreakResult {
  breaks: RowBreakInfo[];
  warnings: LayoutWarning[];
}

/**
 * Calculate row break positions.
 *
 * Algorithm:
 * 1. Accumulate row heights until content height is exceeded.
 * 2. Check manual break positions.
 * 3. Ensure merged cells are not split across page boundaries.
 * 4. Skip hidden rows (0 height contribution).
 */
export function calculateRowBreaks(params: RowBreakParams): RowBreakResult {
  const { startRow, endRow, contentHeight, measurer, manualBreaks, mergedRegions, repeatRows } =
    params;

  const warnings: LayoutWarning[] = [];
  const breaks: RowBreakInfo[] = [];

  // Determine the effective start row (after repeat rows)
  let effectiveStartRow = startRow;
  if (repeatRows) {
    effectiveStartRow = Math.max(startRow, repeatRows[1] + 1);
  }

  // Fix 3: If repeat rows consume the entire print area, nothing to paginate
  if (effectiveStartRow > endRow) {
    breaks.push({ startRow: startRow, isManualBreak: false });
    return { breaks, warnings };
  }

  // First break at the start
  breaks.push({ startRow: effectiveStartRow, isManualBreak: false });

  if (contentHeight <= 0) {
    return { breaks, warnings };
  }

  let currentHeight = 0;
  let row = effectiveStartRow;

  while (row <= endRow) {
    // Skip hidden rows
    if (measurer.isRowHidden(row)) {
      row++;
      continue;
    }

    const rowHeight = measurer.getRowHeight(row);

    // Fix 2: Zero-height row — skip it, don't accumulate
    if (rowHeight <= 0) {
      row++;
      continue;
    }

    // Check for manual break at this row
    const isManualBreak = manualBreaks.has(row) && row !== effectiveStartRow;

    // Would adding this row exceed the page?
    // Fix 6: Use epsilon-tolerant comparison to prevent floating-point drift
    const EPSILON = 0.01; // 0.01 points tolerance
    const wouldExceed = currentHeight + rowHeight > contentHeight + EPSILON && currentHeight > 0;

    if (isManualBreak || wouldExceed) {
      // Determine the actual break row, adjusted for merged cells
      let breakRow = row;
      const isBreakManual = isManualBreak;

      // Check if this break would split a merged cell
      const adjustedBreak = adjustBreakForMerges(breakRow, mergedRegions, effectiveStartRow);
      if (adjustedBreak.adjusted) {
        breakRow = adjustedBreak.breakRow;
        if (adjustedBreak.warnMerge) {
          warnings.push({
            type: 'manual_break_in_merge',
            message: `Manual break at row ${row} moved to row ${breakRow} to avoid splitting merged cell`,
          });
        }
      }

      // Check if the merged region is taller than one full page
      const mergeAtBreak = findMergeContainingRow(breakRow, mergedRegions);
      if (mergeAtBreak) {
        const mergeHeight = getMergeRowHeight(mergeAtBreak, measurer);
        if (mergeHeight > contentHeight) {
          // Merge taller than page — split at merge boundary
          warnings.push({
            type: 'merge_overflow_row',
            message: `Merged region rows ${mergeAtBreak.startRow}-${mergeAtBreak.endRow} is taller than one page`,
          });
          // Place break at the merge start (best effort)
          breakRow = mergeAtBreak.startRow;
          if (breakRow <= breaks[breaks.length - 1].startRow) {
            // Can't go back, just place break at current row
            breakRow = row;
          }
        }
      }

      // Don't create a duplicate break at the same position
      if (breakRow > breaks[breaks.length - 1].startRow) {
        breaks.push({ startRow: breakRow, isManualBreak: isBreakManual });
        // Reset height accumulation from the break row
        currentHeight = 0;
        row = breakRow;
        continue;
      }
    }

    currentHeight += rowHeight;
    row++;
  }

  return { breaks, warnings };
}

/**
 * Adjust a break position to avoid splitting a merged cell.
 * Moves the break to before the merge starts.
 */
function adjustBreakForMerges(
  breakRow: number,
  mergedRegions: MergedRegion[],
  minRow: number,
): { adjusted: boolean; breakRow: number; warnMerge: boolean } {
  for (const merge of mergedRegions) {
    // Check if the break falls inside a merge (not at start)
    if (breakRow > merge.startRow && breakRow <= merge.endRow) {
      const adjusted = Math.max(merge.startRow, minRow);
      return { adjusted: true, breakRow: adjusted, warnMerge: true };
    }
  }
  return { adjusted: false, breakRow, warnMerge: false };
}

/**
 * Find a merged region that contains the given row at its start boundary.
 */
function findMergeContainingRow(row: number, mergedRegions: MergedRegion[]): MergedRegion | null {
  for (const merge of mergedRegions) {
    if (row >= merge.startRow && row <= merge.endRow) {
      return merge;
    }
  }
  return null;
}

/**
 * Calculate the total height of a merged region, accounting for hidden rows.
 */
function getMergeRowHeight(merge: MergedRegion, measurer: ContentMeasurer): number {
  let height = 0;
  for (let r = merge.startRow; r <= merge.endRow; r++) {
    if (!measurer.isRowHidden(r)) {
      height += measurer.getRowHeight(r);
    }
  }
  return height;
}
