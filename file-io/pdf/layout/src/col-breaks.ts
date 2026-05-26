/**
 * col-breaks.ts — Column break calculation with merge awareness and grouping
 *
 * Calculates where vertical (column) page breaks should occur,
 * respecting merged regions, manual page breaks, hidden columns,
 * column grouping hints, and orphan prevention.
 */

import type { ColBreakInfo, ContentMeasurer, LayoutWarning, MergedRegion } from './types';

/**
 * Parameters for column break calculation.
 */
export interface ColBreakParams {
  startCol: number;
  endCol: number;
  contentWidth: number;
  measurer: ContentMeasurer;
  manualBreaks: Set<number>;
  mergedRegions: MergedRegion[];
  repeatCols?: [number, number];
  columnGroups?: [number, number][];
}

/**
 * Result of column break calculation.
 */
export interface ColBreakResult {
  breaks: ColBreakInfo[];
  warnings: LayoutWarning[];
}

/**
 * Calculate column break positions.
 *
 * Algorithm:
 * 1. Accumulate column widths until content width is exceeded.
 * 2. Check manual break positions.
 * 3. Ensure merged cells are not split across page boundaries.
 * 4. Respect column grouping hints.
 * 5. Apply orphan prevention.
 * 6. Skip hidden columns.
 */
export function calculateColBreaks(params: ColBreakParams): ColBreakResult {
  const {
    startCol,
    endCol,
    contentWidth,
    measurer,
    manualBreaks,
    mergedRegions,
    repeatCols,
    columnGroups,
  } = params;

  const warnings: LayoutWarning[] = [];
  const breaks: ColBreakInfo[] = [];

  // Effective start column (after repeat columns)
  let effectiveStartCol = startCol;
  if (repeatCols) {
    effectiveStartCol = Math.max(startCol, repeatCols[1] + 1);
  }

  // Fix 3: If repeat cols consume the entire print area, nothing to paginate
  if (effectiveStartCol > endCol) {
    breaks.push({ startCol: startCol, isManualBreak: false });
    return { breaks, warnings };
  }

  // First break at the start
  breaks.push({ startCol: effectiveStartCol, isManualBreak: false });

  if (contentWidth <= 0) {
    return { breaks, warnings };
  }

  let currentWidth = 0;
  let col = effectiveStartCol;

  while (col <= endCol) {
    // Skip hidden columns
    if (measurer.isColHidden(col)) {
      col++;
      continue;
    }

    const colWidth = measurer.getColumnWidth(col);

    // Fix 2: Zero-width column — skip it, don't accumulate
    if (colWidth <= 0) {
      col++;
      continue;
    }

    // Check for manual break at this column
    const isManualBreak = manualBreaks.has(col) && col !== effectiveStartCol;

    // Would adding this column exceed the page?
    const wouldExceed = currentWidth + colWidth > contentWidth && currentWidth > 0;

    if (isManualBreak || wouldExceed) {
      let breakCol = col;
      const isBreakManual = isManualBreak;

      // Check if this break would split a merged cell
      const adjustedBreak = adjustBreakForMerges(breakCol, mergedRegions, effectiveStartCol);
      if (adjustedBreak.adjusted) {
        breakCol = adjustedBreak.breakCol;
        if (adjustedBreak.warnMerge) {
          warnings.push({
            type: 'manual_break_in_merge',
            message: `Manual break at col ${col} moved to col ${breakCol} to avoid splitting merged cell`,
          });
        }
      }

      // Check if the merged region is wider than one full page
      const mergeAtBreak = findMergeContainingCol(breakCol, mergedRegions);
      if (mergeAtBreak) {
        const mergeWidth = getMergeColWidth(mergeAtBreak, measurer);
        if (mergeWidth > contentWidth) {
          warnings.push({
            type: 'merge_overflow_col',
            message: `Merged region cols ${mergeAtBreak.startCol}-${mergeAtBreak.endCol} is wider than one page`,
          });
          breakCol = mergeAtBreak.startCol;
          if (breakCol <= breaks[breaks.length - 1].startCol) {
            breakCol = col;
          }
        }
      }

      // Check column group constraint
      if (columnGroups && !isManualBreak) {
        const groupAdj = adjustBreakForGroups(breakCol, columnGroups, effectiveStartCol);
        if (groupAdj.adjusted) {
          breakCol = groupAdj.breakCol;
        }
      }

      // Don't create duplicate break
      if (breakCol > breaks[breaks.length - 1].startCol) {
        breaks.push({ startCol: breakCol, isManualBreak: isBreakManual });
        currentWidth = 0;
        col = breakCol;
        continue;
      } else {
        // Fix 1: Group/merge adjustment pushed break before previous break —
        // skip this break and continue accumulating width from the next column
        currentWidth += colWidth;
        col++;
        continue;
      }
    }

    currentWidth += colWidth;
    col++;
  }

  // Apply orphan prevention and column fill optimization
  applyOrphanPrevention(breaks, startCol, endCol, contentWidth, measurer, warnings);
  applyColumnFillOptimization(breaks, startCol, endCol, contentWidth, measurer, warnings);

  return { breaks, warnings };
}

/**
 * Adjust a break position to avoid splitting a merged cell.
 */
function adjustBreakForMerges(
  breakCol: number,
  mergedRegions: MergedRegion[],
  minCol: number,
): { adjusted: boolean; breakCol: number; warnMerge: boolean } {
  for (const merge of mergedRegions) {
    if (breakCol > merge.startCol && breakCol <= merge.endCol) {
      const adjusted = Math.max(merge.startCol, minCol);
      return { adjusted: true, breakCol: adjusted, warnMerge: true };
    }
  }
  return { adjusted: false, breakCol, warnMerge: false };
}

/**
 * Find a merged region that contains the given column.
 */
function findMergeContainingCol(col: number, mergedRegions: MergedRegion[]): MergedRegion | null {
  for (const merge of mergedRegions) {
    if (col >= merge.startCol && col <= merge.endCol) {
      return merge;
    }
  }
  return null;
}

/**
 * Calculate the total width of a merged region, accounting for hidden columns.
 */
function getMergeColWidth(merge: MergedRegion, measurer: ContentMeasurer): number {
  let width = 0;
  for (let c = merge.startCol; c <= merge.endCol; c++) {
    if (!measurer.isColHidden(c)) {
      width += measurer.getColumnWidth(c);
    }
  }
  return width;
}

/**
 * Adjust a break to respect column group boundaries.
 * If the break falls inside a "keep together" group, move it to before the group.
 */
function adjustBreakForGroups(
  breakCol: number,
  columnGroups: [number, number][],
  minCol: number,
): { adjusted: boolean; breakCol: number } {
  for (const [groupStart, groupEnd] of columnGroups) {
    if (breakCol > groupStart && breakCol <= groupEnd) {
      const adjusted = Math.max(groupStart, minCol);
      return { adjusted: true, breakCol: adjusted };
    }
  }
  return { adjusted: false, breakCol };
}

/**
 * Orphan prevention: don't isolate a single column on its own page.
 * If the last section contains only one visible column and it can fit
 * with the previous section, merge them.
 */
function applyOrphanPrevention(
  breaks: ColBreakInfo[],
  _startCol: number,
  endCol: number,
  contentWidth: number,
  measurer: ContentMeasurer,
  warnings: LayoutWarning[],
): void {
  if (breaks.length < 2) return;

  const lastBreak = breaks[breaks.length - 1];
  // Count visible columns in the last section
  let visibleCount = 0;
  let lastSectionWidth = 0;
  for (let c = lastBreak.startCol; c <= endCol; c++) {
    if (!measurer.isColHidden(c)) {
      visibleCount++;
      lastSectionWidth += measurer.getColumnWidth(c);
    }
  }

  if (visibleCount === 1 && !lastBreak.isManualBreak) {
    // Check if we can merge with previous section
    const prevBreak = breaks[breaks.length - 2];
    const prevEnd = lastBreak.startCol - 1;
    let prevWidth = 0;
    for (let c = prevBreak.startCol; c <= prevEnd; c++) {
      if (!measurer.isColHidden(c)) {
        prevWidth += measurer.getColumnWidth(c);
      }
    }

    if (prevWidth + lastSectionWidth <= contentWidth) {
      // Remove the last break (merge sections)
      breaks.pop();
      warnings.push({
        type: 'orphan_column',
        message: `Orphan column at ${lastBreak.startCol} merged with previous section`,
      });
    }
  }
}

/**
 * Column fill optimization: if the last column section uses less than
 * 25% of available width, try to redistribute by removing the last break.
 */
function applyColumnFillOptimization(
  breaks: ColBreakInfo[],
  _startCol: number,
  endCol: number,
  contentWidth: number,
  measurer: ContentMeasurer,
  _warnings: LayoutWarning[],
): void {
  if (breaks.length < 2) return;

  const lastBreak = breaks[breaks.length - 1];
  if (lastBreak.isManualBreak) return;

  let lastSectionWidth = 0;
  for (let c = lastBreak.startCol; c <= endCol; c++) {
    if (!measurer.isColHidden(c)) {
      lastSectionWidth += measurer.getColumnWidth(c);
    }
  }

  const fillRatio = lastSectionWidth / contentWidth;
  if (fillRatio < 0.25) {
    // Try merging with previous section
    const prevBreak = breaks[breaks.length - 2];
    const prevEnd = lastBreak.startCol - 1;
    let prevWidth = 0;
    for (let c = prevBreak.startCol; c <= prevEnd; c++) {
      if (!measurer.isColHidden(c)) {
        prevWidth += measurer.getColumnWidth(c);
      }
    }

    if (prevWidth + lastSectionWidth <= contentWidth) {
      breaks.pop();
    }
  }
}
