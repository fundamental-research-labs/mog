/**
 * Border Action Handlers
 *
 * Handles all border-related formatting actions:
 * - Outline and remove borders
 * - Individual edge borders (top, bottom, left, right)
 * - Inside borders (horizontal, vertical, all)
 * - Diagonal borders
 * - Compound borders (top+bottom, top+thick bottom, etc.)
 * - Format Cells dialog border integration
 *
 * Multi-sheet support for broadcasting changes
 * Protection: All handlers skip protected cells silently (Excel behavior)
 *
 *
 * PERFORMANCE OPTIMIZATION (
 * Border handlers are categorized by whether they can use row/column-level storage:
 *
 * Category A: Position-Independent Borders (can use row/column storage - O(1))
 * - REMOVE_BORDERS, SET_ALL_BORDERS, SET_DIAGONAL_* - same border on every cell
 * - These use setFormatForRanges() for O(1) per row/column
 *
 * Category B: Position-Dependent Borders (edge-range decomposition)
 * - APPLY_OUTLINE_BORDER, APPLY_BORDERS outline/inside presets
 * - SET_INSIDE_BORDERS, SET_INSIDE_HORIZONTAL/VERTICAL_BORDERS
 * - SET_TOP/BOTTOM/LEFT/RIGHT_BORDER, compound top+bottom variants
 * - Decomposed into edge ranges using setFormatForRanges()
 * - Clamp full row/column selections to data bounds first
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { BorderPresetMode, CellBorders, CellRange } from '@mog-sdk/contracts/core';

import {
  callUIStoreAction,
  getSelectionContext,
  getTargetSheetIds,
  getUIStore,
  handled,
} from './shared';

// Border constants - temporarily defined locally
// Note: These may be imported from './constants/border-presets' once that file is created
const thinBorder = { style: 'thin' as const, color: '#000000' };
const thickBorder = { style: 'thick' as const, color: '#000000' };
const doubleBorder = { style: 'double' as const, color: '#000000' };
const noBorders: CellBorders = {};
const MAX_VISIBILITY_SCAN_INDEXES = 1000;

type HiddenLayout = {
  getHiddenRowsBitmap?: () => Promise<Set<number>>;
  getHiddenColumnsBitmap?: () => Promise<Set<number>>;
  isRowHidden?: (row: number) => Promise<boolean>;
  isColumnHidden?: (col: number) => Promise<boolean>;
};

type WorksheetWithLayout = {
  layout?: HiddenLayout;
};

function contiguousVisibleSpans(
  start: number,
  end: number,
  hiddenIndexes: Set<number>,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let spanStart: number | null = null;

  for (let index = start; index <= end; index++) {
    if (hiddenIndexes.has(index)) {
      if (spanStart != null) {
        spans.push({ start: spanStart, end: index - 1 });
        spanStart = null;
      }
      continue;
    }

    spanStart ??= index;
  }

  if (spanStart != null) {
    spans.push({ start: spanStart, end });
  }

  return spans;
}

async function readHiddenBitmap(
  layout: HiddenLayout | undefined,
  method: 'getHiddenRowsBitmap' | 'getHiddenColumnsBitmap',
): Promise<Set<number>> {
  const read = layout?.[method];
  return typeof read === 'function' ? read.call(layout) : new Set<number>();
}

async function readHiddenIndexesInRange(
  layout: HiddenLayout | undefined,
  bitmapMethod: 'getHiddenRowsBitmap' | 'getHiddenColumnsBitmap',
  itemMethod: 'isRowHidden' | 'isColumnHidden',
  start: number,
  end: number,
): Promise<Set<number>> {
  const hidden = new Set(await readHiddenBitmap(layout, bitmapMethod));
  const count = end - start + 1;
  const readItem = layout?.[itemMethod];
  if (typeof readItem !== 'function' || count <= 0 || count > MAX_VISIBILITY_SCAN_INDEXES) {
    return hidden;
  }

  const visibility = await Promise.all(
    Array.from({ length: count }, async (_, offset) => {
      const index = start + offset;
      return [index, await readItem.call(layout, index)] as const;
    }),
  );
  for (const [index, isHidden] of visibility) {
    if (isHidden) hidden.add(index);
  }

  return hidden;
}

async function splitRangeByVisibleDimensions(
  worksheet: WorksheetWithLayout,
  range: CellRange,
): Promise<CellRange[]> {
  const [hiddenRows, hiddenCols] = await Promise.all([
    readHiddenIndexesInRange(
      worksheet.layout,
      'getHiddenRowsBitmap',
      'isRowHidden',
      range.startRow,
      range.endRow,
    ),
    readHiddenIndexesInRange(
      worksheet.layout,
      'getHiddenColumnsBitmap',
      'isColumnHidden',
      range.startCol,
      range.endCol,
    ),
  ]);
  if (hiddenRows.size === 0 && hiddenCols.size === 0) {
    return [range];
  }

  const rowSpans = contiguousVisibleSpans(range.startRow, range.endRow, hiddenRows);
  const colSpans = contiguousVisibleSpans(range.startCol, range.endCol, hiddenCols);
  if (rowSpans.length === 0 || colSpans.length === 0) {
    return [range];
  }

  const visibleRanges: CellRange[] = [];

  for (const rowSpan of rowSpans) {
    for (const colSpan of colSpans) {
      visibleRanges.push({
        startRow: rowSpan.start,
        startCol: colSpan.start,
        endRow: rowSpan.end,
        endCol: colSpan.end,
      });
    }
  }

  return visibleRanges;
}

// =============================================================================
// Border Handlers
// =============================================================================

/**
 * Apply outline border to selected cells.
 * Adds a thin black border around the outer edges of each selection range.
 *
 * CATEGORY B: Position-Dependent - needs data bounds clamping
 * "Outline border on column A" means the outline of the USED range in column A,
 * not a border around 1M hypothetical cells.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const APPLY_OUTLINE_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp full row/column selections to data bounds
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const outlineRanges = await splitRangeByVisibleDimensions(ws, clampedRange);

      for (const outlineRange of outlineRanges) {
        const { startRow, startCol, endRow, endCol } = outlineRange;

        // Decompose outline into 4 edge ranges — 4 IPC calls instead of N*M
        // Top edge: apply top border to first row
        const topRange = { startRow, startCol, endRow: startRow, endCol };
        await ws.formats.setRanges([topRange], { borders: { top: thinBorder } });

        // Bottom edge: apply bottom border to last row
        const bottomRange = { startRow: endRow, startCol, endRow, endCol };
        await ws.formats.setRanges([bottomRange], { borders: { bottom: thinBorder } });

        // Left edge: apply left border to first column
        const leftRange = { startRow, startCol, endRow, endCol: startCol };
        await ws.formats.setRanges([leftRange], { borders: { left: thinBorder } });

        // Right edge: apply right border to last column
        const rightRange = { startRow, startCol: endCol, endRow, endCol };
        await ws.formats.setRanges([rightRange], { borders: { right: thinBorder } });
      }
    }
  }

  return handled();
};

/**
 * Remove all borders from selected cells.
 *
 * CATEGORY A: Position-Independent - can use row/column format storage
 * "No borders" is the same for every cell, so we can use O(1) storage per row/column.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const REMOVE_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to ALL selected sheets
  // Performance: Uses row/column format storage for full row/column selections
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { borders: noBorders });
  }

  return handled();
};

/**
 * Apply borders from Format Cells dialog or directly via payload.
 * Supports two modes:
 * 1. UIStore mode (Draft + Apply pattern): Uses pending border format from UIStore
 * 2. Direct mode: Accepts borders via payload for immediate application (used by toolbar)
 *
 * CATEGORY B: Position-Dependent - needs data bounds clamping
 * The outline and inside presets depend on cell position.
 *
 * CRITICAL: Protection Check Pattern
 * - Uses ws.canEditCell() which returns Promise<boolean> directly
 * - Silently skips protected cells when sheet is protected (Excel behavior)
 *
 * Border Preset Modes:
 * - 'none': Remove all borders from all cells (uses Category A approach)
 * - 'outline': Apply borders to outer edges of selection only
 * - 'inside': Apply borders to internal cell dividers only (between cells)
 * - null: Apply borders as specified to all cells (uses Category A approach)
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const APPLY_BORDERS: AsyncActionHandler = async (
  deps,
  payload?: { borders: CellBorders; preset?: BorderPresetMode },
) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Determine border format source: payload (direct mode) or UIStore (dialog mode)
  let borderFormat: CellBorders | undefined;
  let borderPreset: BorderPresetMode = null;
  const isDirectMode = payload?.borders !== undefined;

  if (isDirectMode) {
    // Direct mode: Use borders + preset from payload (toolbar setBorder).
    // The preset must come from the payload — without it, compound presets
    // like "Outside Borders" would fall back to per-cell apply and
    // diverge from the dropdown.
    borderFormat = payload!.borders;
    borderPreset = payload!.preset ?? null;

    // Record the user's pick as last-used so subsequent main-clicks on
    // the toolbar's Borders SplitButton replay this exact selection.
    // Direct-mode payloads always represent an explicit user pick
    // (toolbar dropdown or replay), including the "No Border" preset.
    getUIStore(deps)
      .getState()
      .setLastUsedBorderFormat({
        borders: payload!.borders,
        preset: payload!.preset ?? null,
      });
  } else {
    // UIStore mode: Read pending borders from UIStore (Format Cells dialog).
    // Dialog-mode writes are NOT recorded as last-used — the dialog is a
    // multi-tab Apply, not a toolbar pick. Excel parity.
    const uiState = getUIStore(deps).getState();
    borderFormat = uiState.pendingBorderFormat ?? undefined;
    borderPreset = uiState.pendingBorderPreset;
  }

  if (!borderFormat) {
    return handled();
  }

  // Handle position-independent cases with Category A approach
  if (borderPreset === 'none') {
    // 'none' preset: Remove all borders - position-independent
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.formats.setRanges(ranges, { borders: noBorders });
    }
    // Only clear UIStore if we used it (not in direct mode)
    if (!isDirectMode) {
      callUIStoreAction(deps, (state) => {
        state.clearPendingBorderFormat();
        state.clearPendingBorderPreset();
      });
    }
    return handled();
  }

  if (!borderPreset) {
    // Default (no preset): Apply borders as specified to all cells - position-independent
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.formats.setRanges(ranges, { borders: borderFormat });
    }
    // Only clear UIStore if we used it (not in direct mode)
    if (!isDirectMode) {
      callUIStoreAction(deps, (state) => {
        state.clearPendingBorderFormat();
        state.clearPendingBorderPreset();
      });
    }
    return handled();
  }

  // Apply to ALL selected sheets - position-dependent presets (outline, inside)
  // Decomposed into edge ranges for batch writes instead of per-cell loops
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp full row/column selections to data bounds
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);

      if (borderPreset === 'outline') {
        // Outline preset: 4 edge ranges per visible rectangle. Hidden rows/columns
        // split the rectangle because users see each visible block as its own perimeter.
        const outlineRanges = await splitRangeByVisibleDimensions(ws, clampedRange);
        for (const outlineRange of outlineRanges) {
          const { startRow, startCol, endRow, endCol } = outlineRange;

          if (borderFormat.top) {
            const topRange = { startRow, startCol, endRow: startRow, endCol };
            await ws.formats.setRanges([topRange], { borders: { top: borderFormat.top } });
          }
          if (borderFormat.bottom) {
            const bottomRange = { startRow: endRow, startCol, endRow, endCol };
            await ws.formats.setRanges([bottomRange], {
              borders: { bottom: borderFormat.bottom },
            });
          }
          if (borderFormat.left) {
            const leftRange = { startRow, startCol, endRow, endCol: startCol };
            await ws.formats.setRanges([leftRange], { borders: { left: borderFormat.left } });
          }
          if (borderFormat.right) {
            const rightRange = { startRow, startCol: endCol, endRow, endCol };
            await ws.formats.setRanges([rightRange], { borders: { right: borderFormat.right } });
          }
        }
      } else if (borderPreset === 'inside') {
        const { startRow, startCol, endRow, endCol } = clampedRange;
        // Inside preset: internal horizontal + vertical dividers
        // Bottom border on all rows except the last (horizontal dividers)
        if (endRow > startRow && borderFormat.bottom) {
          const hRange = { startRow, startCol, endRow: endRow - 1, endCol };
          await ws.formats.setRanges([hRange], { borders: { bottom: borderFormat.bottom } });
        }
        // Right border on all columns except the last (vertical dividers)
        if (endCol > startCol && borderFormat.right) {
          const vRange = { startRow, startCol, endRow, endCol: endCol - 1 };
          await ws.formats.setRanges([vRange], { borders: { right: borderFormat.right } });
        }
      }
    }
  }

  // Clear pending format after application (only if we used UIStore mode)
  if (!isDirectMode) {
    callUIStoreAction(deps, (state) => {
      state.clearPendingBorderFormat();
      state.clearPendingBorderPreset();
    });
  }

  return handled();
};

// =============================================================================
// Additional Border Handlers
// =============================================================================

/**
 * Apply all borders (outline + inside) to selected cells.
 *
 * CATEGORY A: Position-Independent - can use row/column format storage
 * "All 4 borders" is the same for every cell, so we can use O(1) storage per row/column.
 *
 * Multi-Sheet Support
 * Note: Protection checking is not done at row/column level for performance.
 * This matches Excel behavior where format changes apply to unprotected cells.
 */
export const SET_ALL_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  const allBorders = {
    borders: {
      top: thinBorder,
      bottom: thinBorder,
      left: thinBorder,
      right: thinBorder,
    },
  };

  // Performance: Uses row/column format storage for full row/column selections
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, allBorders);
  }

  return handled();
};

/**
 * Apply inside borders only (between cells) to selected cells.
 *
 * CATEGORY B: Position-Dependent - needs data bounds clamping
 * Inside borders depend on cell position (not applied to last row/column).
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_INSIDE_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp full row/column selections to data bounds
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Inside horizontal: bottom border on all rows except the last
      if (endRow > startRow) {
        const hRange = { startRow, startCol, endRow: endRow - 1, endCol };
        await ws.formats.setRanges([hRange], { borders: { bottom: thinBorder } });
      }
      // Inside vertical: right border on all columns except the last
      if (endCol > startCol) {
        const vRange = { startRow, startCol, endRow, endCol: endCol - 1 };
        await ws.formats.setRanges([vRange], { borders: { right: thinBorder } });
      }
    }
  }

  return handled();
};

/**
 * Apply inside horizontal borders only.
 *
 * CATEGORY B: Position-Dependent - needs data bounds clamping
 * Horizontal borders depend on cell position (not applied to last row).
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_INSIDE_HORIZONTAL_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp full row/column selections to data bounds
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Inside horizontal: bottom border on all rows except the last
      if (endRow > startRow) {
        const hRange = { startRow, startCol, endRow: endRow - 1, endCol };
        await ws.formats.setRanges([hRange], { borders: { bottom: thinBorder } });
      }
    }
  }

  return handled();
};

/**
 * Apply inside vertical borders only.
 *
 * CATEGORY B: Position-Dependent - needs data bounds clamping
 * Vertical borders depend on cell position (not applied to last column).
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_INSIDE_VERTICAL_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp full row/column selections to data bounds
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Inside vertical: right border on all columns except the last
      if (endCol > startCol) {
        const vRange = { startRow, startCol, endRow, endCol: endCol - 1 };
        await ws.formats.setRanges([vRange], { borders: { right: thinBorder } });
      }
    }
  }

  return handled();
};

/**
 * Apply top border to selected cells.
 *
 * EDGE-ONLY: Iterates only the top row - O(cols)
 * For full row selections, this iterates 16K+ cols without clamping.
 * We clamp to data bounds for full row selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_TOP_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full row selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endCol } = clampedRange;

      // Top border on the first row of the selection
      const topRange = { startRow, startCol, endRow: startRow, endCol };
      await ws.formats.setRanges([topRange], { borders: { top: thinBorder } });
    }
  }

  return handled();
};

/**
 * Apply bottom border to selected cells.
 *
 * EDGE-ONLY: Iterates only the bottom row - O(cols)
 * For full row selections, this iterates 16K+ cols without clamping.
 * We clamp to data bounds for full row selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_BOTTOM_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full row selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startCol, endRow, endCol } = clampedRange;

      // Bottom border on the last row of the selection
      const bottomRange = { startRow: endRow, startCol, endRow, endCol };
      await ws.formats.setRanges([bottomRange], { borders: { bottom: thinBorder } });
    }
  }

  return handled();
};

/**
 * Apply left border to selected cells.
 *
 * EDGE-ONLY: Iterates only the left column - O(rows)
 * For full column selections, this iterates 1M+ rows without clamping.
 * We clamp to data bounds for full column selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_LEFT_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full column selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow } = clampedRange;

      // Left border on the first column of the selection
      const leftRange = { startRow, startCol, endRow, endCol: startCol };
      await ws.formats.setRanges([leftRange], { borders: { left: thinBorder } });
    }
  }

  return handled();
};

/**
 * Apply right border to selected cells.
 *
 * EDGE-ONLY: Iterates only the right column - O(rows)
 * For full column selections, this iterates 1M+ rows without clamping.
 * We clamp to data bounds for full column selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_RIGHT_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full column selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, endRow, endCol } = clampedRange;

      // Right border on the last column of the selection
      const rightRange = { startRow, startCol: endCol, endRow, endCol };
      await ws.formats.setRanges([rightRange], { borders: { right: thinBorder } });
    }
  }

  return handled();
};

/**
 * Apply diagonal up border (bottom-left to top-right) to selected cells.
 *
 * CATEGORY A: Position-Independent - can use row/column format storage
 * Diagonal borders are the same for every cell, so we can use O(1) storage per row/column.
 *
 * Multi-Sheet Support
 */
export const SET_DIAGONAL_UP_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  const diagonalUpBorder = {
    borders: {
      diagonal: { ...thinBorder, direction: 'up' as const },
    },
  };

  // Performance: Uses row/column format storage for full row/column selections
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, diagonalUpBorder);
  }

  return handled();
};

/**
 * Apply diagonal down border (top-left to bottom-right) to selected cells.
 *
 * CATEGORY A: Position-Independent - can use row/column format storage
 * Diagonal borders are the same for every cell, so we can use O(1) storage per row/column.
 *
 * Multi-Sheet Support
 */
export const SET_DIAGONAL_DOWN_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  const diagonalDownBorder = {
    borders: {
      diagonal: { ...thinBorder, direction: 'down' as const },
    },
  };

  // Performance: Uses row/column format storage for full row/column selections
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, diagonalDownBorder);
  }

  return handled();
};

/**
 * Apply both diagonal borders to selected cells.
 *
 * CATEGORY A: Position-Independent - can use row/column format storage
 * Diagonal borders are the same for every cell, so we can use O(1) storage per row/column.
 *
 * Multi-Sheet Support
 */
export const SET_DIAGONAL_BOTH_BORDER: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  const diagonalBothBorder = {
    borders: {
      diagonal: { ...thinBorder, direction: 'both' as const },
    },
  };

  // Performance: Uses row/column format storage for full row/column selections
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, diagonalBothBorder);
  }

  return handled();
};

/**
 * Apply top and bottom borders to selected cells.
 *
 * EDGE-ONLY (compound): Iterates top and bottom rows - O(2 * cols)
 * We clamp to data bounds for full row selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_TOP_AND_BOTTOM_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full row selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Top border on first row
      const topRange = { startRow, startCol, endRow: startRow, endCol };
      await ws.formats.setRanges([topRange], { borders: { top: thinBorder } });

      // Bottom border on last row
      const bottomRange = { startRow: endRow, startCol, endRow, endCol };
      await ws.formats.setRanges([bottomRange], { borders: { bottom: thinBorder } });
    }
  }

  return handled();
};

/**
 * Apply top (thin) and thick bottom borders to selected cells.
 *
 * EDGE-ONLY (compound): Iterates top and bottom rows - O(2 * cols)
 * We clamp to data bounds for full row selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_TOP_AND_THICK_BOTTOM_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full row selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Top border (thin) on first row
      const topRange = { startRow, startCol, endRow: startRow, endCol };
      await ws.formats.setRanges([topRange], { borders: { top: thinBorder } });

      // Bottom border (thick) on last row
      const bottomRange = { startRow: endRow, startCol, endRow, endCol };
      await ws.formats.setRanges([bottomRange], { borders: { bottom: thickBorder } });
    }
  }

  return handled();
};

/**
 * Apply top (thin) and double bottom borders to selected cells.
 *
 * EDGE-ONLY (compound): Iterates top and bottom rows - O(2 * cols)
 * We clamp to data bounds for full row selections.
 *
 * Multi-Sheet Support
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const SET_TOP_AND_DOUBLE_BOTTOM_BORDERS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    for (const range of ranges) {
      // Performance: Clamp to data bounds for full row selections
      const clampedRange = await ws._internal.clampRangeToDataBounds(range);
      const { startRow, startCol, endRow, endCol } = clampedRange;

      // Top border (thin) on first row
      const topRange = { startRow, startCol, endRow: startRow, endCol };
      await ws.formats.setRanges([topRange], { borders: { top: thinBorder } });

      // Bottom border (double) on last row
      const bottomRange = { startRow: endRow, startCol, endRow, endCol };
      await ws.formats.setRanges([bottomRange], { borders: { bottom: doubleBorder } });
    }
  }

  return handled();
};
