/**
 * Selection Handlers - Go To Special
 *
 * Handles Go To Special selection operations (14 handlers):
 * - SELECT_BLANKS, SELECT_CONSTANTS, SELECT_FORMULAS, SELECT_NUMBERS
 * - SELECT_TEXT, SELECT_LOGICALS, SELECT_ERRORS, SELECT_LAST_CELL
 * - SELECT_CELLS_WITH_CONDITIONAL_FORMATS, SELECT_CELLS_WITH_DATA_VALIDATION
 * - SELECT_CELLS_WITH_SAME_VALIDATION, SELECT_CELLS_WITH_COMMENTS
 * - SELECT_CURRENT_ARRAY, SELECT_OBJECTS
 *
 */

import { findLastUsedCell } from '../../../infra/utils';
import { cellCoordsToOptimizedRanges } from './special-selections';

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import {
  createCellValueGetter,
  handled,
  normalizeRange,
  type ActionDependencies,
  type ActionHandler,
  type CellCoord,
} from './helpers';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse an A1 range string (e.g., "A1:D10") into numeric bounds.
 * Uses the Workbook.addressToIndex utility for column letter resolution.
 */
function parseA1Range(
  rangeStr: string,
  wb: import('@mog-sdk/contracts/api').Workbook,
): { startRow: number; startCol: number; endRow: number; endCol: number } {
  const [startAddr, endAddr] = rangeStr.split(':');
  const start = wb.addressToIndex(startAddr);
  if (!endAddr) {
    return { startRow: start.row, startCol: start.col, endRow: start.row, endCol: start.col };
  }
  const end = wb.addressToIndex(endAddr);
  return { startRow: start.row, startCol: start.col, endRow: end.row, endCol: end.col };
}

/**
 * Helper to execute a Go To Special selection.
 * Finds cells matching the criteria and updates the selection.
 */
async function executeGoToSpecialSelection(
  deps: ActionDependencies,
  type: 'blanks' | 'constants' | 'formulas' | 'numbers' | 'text' | 'logicals' | 'errors',
) {
  const sheetId = deps.getActiveSheetId();
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);
  const ws = deps.workbook.getSheetById(sheetId);

  // Get current selection as the search range
  // If nothing selected or single cell, use the whole used range (Excel behavior)
  let searchRanges = ranges;
  if (
    searchRanges.length === 0 ||
    (searchRanges.length === 1 &&
      searchRanges[0].startRow === searchRanges[0].endRow &&
      searchRanges[0].startCol === searchRanges[0].endCol)
  ) {
    // Single cell selected - search the entire used range (Excel parity)
    // Note: getCurrentRegion only finds contiguous data around the cursor,
    // but Go To Special should search ALL data on the sheet
    const usedRange = await ws.getUsedRange();
    if (!usedRange) {
      // Sheet is empty - nothing to find
      return handled();
    }
    searchRanges = [usedRange];
  }

  // Find all matching cells across all selection ranges
  const matchingCells: CellCoord[] = [];
  for (const range of searchRanges) {
    const normalizedRange = normalizeRange(range);

    // Batch fetch entire range in 1 IPC call (value + formula for every cell)
    const rangeData = await ws.getRange(
      normalizedRange.startRow,
      normalizedRange.startCol,
      normalizedRange.endRow,
      normalizedRange.endCol,
    );

    for (let row = normalizedRange.startRow; row <= normalizedRange.endRow; row++) {
      for (let col = normalizedRange.startCol; col <= normalizedRange.endCol; col++) {
        const rowIdx = row - normalizedRange.startRow;
        const colIdx = col - normalizedRange.startCol;
        const cellData = rangeData[rowIdx]?.[colIdx];
        const value = cellData?.value ?? null;
        const formula = cellData?.formula;

        let matches = false;
        switch (type) {
          case 'blanks':
            matches = value === null || value === undefined || value === '';
            break;
          case 'constants':
            matches = !formula && value !== null && value !== undefined && value !== '';
            break;
          case 'formulas':
            matches = !!formula && formula.length > 0;
            break;
          case 'numbers':
            matches = !formula && typeof value === 'number';
            break;
          case 'text':
            matches = !formula && typeof value === 'string' && value !== '';
            break;
          case 'logicals':
            matches = !formula && typeof value === 'boolean';
            break;
          case 'errors':
            // Check for error values
            matches =
              (value !== null &&
                typeof value === 'object' &&
                'type' in value &&
                value.type === 'error') ||
              (typeof value === 'string' &&
                [
                  'Null',
                  'Div0',
                  'Value',
                  'Ref',
                  'Name',
                  'Num',
                  'Na',
                  'GettingData',
                  'Spill',
                  'Calc',
                ].includes(value));
            break;
        }

        if (matches) {
          matchingCells.push({ row, col });
        }
      }
    }
  }

  if (matchingCells.length === 0) {
    // No matching cells found - keep current selection
    return handled();
  }

  // Convert to optimized ranges
  const optimizedRanges = cellCoordsToOptimizedRanges(matchingCells);

  // Set selection with first matching cell as active cell
  deps.commands.selection.setSelection(optimizedRanges, matchingCells[0]);

  return handled();
}

// =============================================================================
// Go To Special Selection Handlers
// =============================================================================

/**
 * SELECT_BLANKS - Select all blank cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_BLANKS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'blanks');
};

/**
 * SELECT_CONSTANTS - Select all constant (non-formula) cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_CONSTANTS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'constants');
};

/**
 * SELECT_FORMULAS - Select all formula cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_FORMULAS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'formulas');
};

/**
 * SELECT_NUMBERS - Select all numeric constant cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_NUMBERS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'numbers');
};

/**
 * SELECT_TEXT - Select all text constant cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_TEXT: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'text');
};

/**
 * SELECT_LOGICALS - Select all boolean constant cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_LOGICALS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'logicals');
};

/**
 * SELECT_ERRORS - Select all error cells in current selection.
 * Part of Go To Special functionality.
 */
export const SELECT_ERRORS: AsyncActionHandler = async (deps) => {
  return await executeGoToSpecialSelection(deps, 'errors');
};

// =============================================================================
// Go To Special - Additional Selection Types
// =============================================================================

/**
 * SELECT_LAST_CELL - Navigate to the last used cell in the sheet.
 * Part of Go To Special functionality.
 *
 * Excel behavior: Selects the cell at the intersection of the last used row
 * and last used column (bottom-right of the used range).
 */
export const SELECT_LAST_CELL: ActionHandler = (deps) => {
  const getCellValue = createCellValueGetter(deps);

  // Find the last used cell using navigation utilities
  const lastUsed = findLastUsedCell(getCellValue, 10000, 1000);

  // Use GO_TO to move to the last used cell
  deps.commands.selection.goTo(lastUsed);
  return handled();
};

/**
 * SELECT_CELLS_WITH_CONDITIONAL_FORMATS - Select cells with CF rules.
 * Part of Go To Special functionality.
 *
 * Each CFRule has a single `range` string in A1 notation; we parse it to numeric
 * bounds via deps.workbook.addressToIndex().
 *
 * Selects all cells in the current sheet that have conditional formatting rules.
 */
export const SELECT_CELLS_WITH_CONDITIONAL_FORMATS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const allFormats = await ws.conditionalFormats.list();

    if (allFormats.length === 0) {
      // No CF formats found
      return handled();
    }

    // Collect all cells covered by CF ranges
    const cellsWithCF: Set<string> = new Set();

    for (const format of allFormats) {
      if (!format.ranges || format.ranges.length === 0) continue;
      for (const range of format.ranges) {
        for (let row = range.startRow; row <= range.endRow; row++) {
          for (let col = range.startCol; col <= range.endCol; col++) {
            cellsWithCF.add(`${row},${col}`);
          }
        }
      }
    }

    if (cellsWithCF.size === 0) {
      return handled();
    }

    // Convert to CellCoord array
    const cells: CellCoord[] = Array.from(cellsWithCF).map((key) => {
      const [row, col] = key.split(',').map(Number);
      return { row, col };
    });

    // Sort by row then column for consistent order
    cells.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    // Optimize into ranges
    const optimizedRanges = cellCoordsToOptimizedRanges(cells);

    // Set selection with first cell as active
    deps.commands.selection.setSelection(optimizedRanges, cells[0]);
  } catch (err) {
    console.warn('[GoToSpecial] getConditionalFormats failed:', err);
  }

  return handled();
};

/**
 * SELECT_CELLS_WITH_DATA_VALIDATION - Select cells with DV rules.
 * Part of Go To Special functionality.
 *
 * Each ValidationRule has a single `range` string in A1 notation; we parse it
 * to numeric bounds via deps.workbook.addressToIndex().
 *
 * Selects all cells in the current sheet that have data validation rules.
 */
export const SELECT_CELLS_WITH_DATA_VALIDATION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const rules = await ws.validations.list();

    if (rules.length === 0) {
      // No validation rules found
      return handled();
    }

    const cellsWithDV: Set<string> = new Set();

    for (const rule of rules) {
      if (!rule.range) continue;
      const bounds = parseA1Range(rule.range, deps.workbook);
      const minRow = Math.min(bounds.startRow, bounds.endRow);
      const maxRow = Math.max(bounds.startRow, bounds.endRow);
      const minCol = Math.min(bounds.startCol, bounds.endCol);
      const maxCol = Math.max(bounds.startCol, bounds.endCol);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          cellsWithDV.add(`${row},${col}`);
        }
      }
    }

    if (cellsWithDV.size === 0) return handled();

    const cells: CellCoord[] = Array.from(cellsWithDV).map((key) => {
      const [row, col] = key.split(',').map(Number);
      return { row, col };
    });

    cells.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    const optimizedRanges = cellCoordsToOptimizedRanges(cells);
    deps.commands.selection.setSelection(optimizedRanges, cells[0]);
  } catch (err) {
    console.warn('[GoToSpecial] SELECT_CELLS_WITH_DATA_VALIDATION failed:', err);
  }

  return handled();
};

/**
 * SELECT_CELLS_WITH_SAME_VALIDATION - Select cells with the same validation as active cell.
 * Part of Go To Special functionality.
 *
 * Each ValidationRule has a `range` string in A1 notation; we parse it to numeric bounds.
 *
 * Selects all cells in the current sheet that have the same data validation schema
 * as the currently active cell. Uses rule.id comparison for matching.
 */
export const SELECT_CELLS_WITH_SAME_VALIDATION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const rules = await ws.validations.list();

    if (rules.length === 0) {
      // No validation rules found
      return handled();
    }

    // Parse all rule ranges and find the rule containing the active cell
    let activeRuleId: string | null = null;

    const resolvedRules: Array<{
      id: string;
      ranges: Array<{
        minRow: number;
        maxRow: number;
        minCol: number;
        maxCol: number;
      }>;
    }> = [];

    for (const rule of rules) {
      if (!rule.range || !rule.id) continue;
      const bounds = parseA1Range(rule.range, deps.workbook);

      const resolved = {
        minRow: Math.min(bounds.startRow, bounds.endRow),
        maxRow: Math.max(bounds.startRow, bounds.endRow),
        minCol: Math.min(bounds.startCol, bounds.endCol),
        maxCol: Math.max(bounds.startCol, bounds.endCol),
      };

      resolvedRules.push({ id: rule.id, ranges: [resolved] });

      // Check if active cell falls within this range
      if (
        !activeRuleId &&
        activeCell.row >= resolved.minRow &&
        activeCell.row <= resolved.maxRow &&
        activeCell.col >= resolved.minCol &&
        activeCell.col <= resolved.maxCol
      ) {
        activeRuleId = rule.id;
      }
    }

    if (!activeRuleId) {
      // Active cell has no validation
      return handled();
    }

    // Collect all cells with the same rule ID
    const cellsWithSameValidation: Set<string> = new Set();

    for (const resolved of resolvedRules) {
      if (resolved.id !== activeRuleId) continue;

      for (const range of resolved.ranges) {
        for (let row = range.minRow; row <= range.maxRow; row++) {
          for (let col = range.minCol; col <= range.maxCol; col++) {
            cellsWithSameValidation.add(`${row},${col}`);
          }
        }
      }
    }

    if (cellsWithSameValidation.size === 0) return handled();

    const cells: CellCoord[] = Array.from(cellsWithSameValidation).map((key) => {
      const [row, col] = key.split(',').map(Number);
      return { row, col };
    });

    cells.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    const optimizedRanges = cellCoordsToOptimizedRanges(cells);
    deps.commands.selection.setSelection(optimizedRanges, cells[0]);
  } catch (err) {
    console.warn('[GoToSpecial] SELECT_CELLS_WITH_SAME_VALIDATION failed:', err);
  }

  return handled();
};

/**
 * SELECT_CELLS_WITH_COMMENTS - Select cells containing comments/notes.
 * Part of Go To Special functionality.
 *
 * Selects all cells in the current sheet that have comments attached.
 */
export const SELECT_CELLS_WITH_COMMENTS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const allComments = await ws.comments.list();

    if (!allComments || allComments.length === 0) {
      return handled();
    }

    // Collect unique cell positions that have comments. Comment.cellRef is the
    // stable CellId; resolve it through the sheet-scoped internal API.
    const cellsWithComments: CellCoord[] = [];
    const seenCellRefs = new Set<string>();
    const seenCells = new Set<string>();

    for (const comment of allComments) {
      if (seenCellRefs.has(comment.cellRef)) continue;
      seenCellRefs.add(comment.cellRef);

      const position = await ws._internal.getCellPosition(comment.cellRef);
      if (!position) continue;
      const { row, col } = position;
      const key = `${row},${col}`;
      if (!seenCells.has(key)) {
        seenCells.add(key);
        cellsWithComments.push({ row, col });
      }
    }

    if (cellsWithComments.length === 0) {
      return handled();
    }

    // Sort by row then column
    cellsWithComments.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    // Optimize into ranges
    const optimizedRanges = cellCoordsToOptimizedRanges(cellsWithComments);

    // Set selection with first cell as active
    deps.commands.selection.setSelection(optimizedRanges, cellsWithComments[0]);
  } catch (err) {
    console.warn('[GoToSpecial] getComments failed:', err);
  }

  return handled();
};

// =============================================================================
// Go To Special - Remaining Options
// =============================================================================

/**
 * SELECT_CURRENT_ARRAY - Select all cells in the array formula containing the active cell.
 *
 * If the active cell is part of a projection (dynamic array formula), selects
 * the entire projection range.
 */
export const SELECT_CURRENT_ARRAY: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    // Check if cell is a projection anchor with a projection range
    const projectionRange = await ws.bindings.getProjectionRange(activeCell.row, activeCell.col);
    if (projectionRange) {
      deps.commands.selection.setSelection(
        [
          {
            startRow: projectionRange.startRow,
            startCol: projectionRange.startCol,
            endRow: projectionRange.endRow,
            endCol: projectionRange.endCol,
          },
        ],
        activeCell,
      );
      return handled();
    }

    // Check if cell is a projection member (falls within a projected range)
    const projOrigin = await ws.bindings.getProjectionSource(activeCell.row, activeCell.col);
    if (projOrigin) {
      // Get the projection range from the origin (anchor) cell
      const originProjectionRange = await ws.bindings.getProjectionRange(
        projOrigin.row,
        projOrigin.col,
      );
      if (originProjectionRange) {
        deps.commands.selection.setSelection(
          [
            {
              startRow: originProjectionRange.startRow,
              startCol: originProjectionRange.startCol,
              endRow: originProjectionRange.endRow,
              endCol: originProjectionRange.endCol,
            },
          ],
          activeCell,
        );
      }
    }
  } catch (err) {
    console.warn('[GoToSpecial] SELECT_CURRENT_ARRAY failed:', err);
  }

  return handled();
};

/**
 * SELECT_OBJECTS - Select all floating objects (charts, images, shapes) on the sheet.
 *
 * Selects all floating objects. If no objects exist, does nothing.
 * Note: This action focuses on object selection rather than cell selection.
 */
export const SELECT_OBJECTS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const charts = await ws.charts.list();

    // TODO: Integrate FloatingObjectManager for images/shapes selection
    const floatingObjects: { id: string }[] = [];

    // Combine all object IDs
    const allObjectIds: string[] = [
      ...charts.map((c) => c.id),
      ...floatingObjects.map((o: { id: string }) => o.id),
    ];

    if (allObjectIds.length === 0) {
      return handled();
    }

    // route through the typed `commands.object`
    // channel (objectInteractionActor.SELECT_MULTIPLE) instead of the
    // unwired-on-web stringly-typed UI escape hatch.
    deps.commands.object?.selectMultiple(allObjectIds);
  } catch (err) {
    console.warn('[GoToSpecial] listCharts failed:', err);
  }

  return handled();
};
