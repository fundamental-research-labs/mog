/**
 * Data Analysis Dialog Action Handlers
 *
 * Handlers for Goal Seek, Consolidate, Spelling, Watch Window,
 * Error Checking, and Evaluate Formula dialogs.
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
import { parseA1, toA1 } from '@mog/spreadsheet-utils/a1';
// Unified API: setCellValue replaced with ws.setCell in APPLY_GOAL_SEEK_RESULT
import type { SpellingError } from '../../ui-store/slices/dialogs/spelling-dialog';
import { requestFormulaBarRefresh } from '../../infra/events/formula-bar-refresh';
import { guardBridgeMutation } from './bridge-error-guard';
import { getUIStore } from './handler-utils';

// =============================================================================
// Goal Seek Dialog Handlers
// =============================================================================

/**
 * Open Goal Seek dialog
 */
export const OPEN_GOAL_SEEK_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  let setCell: string | undefined;
  const activeCell = deps.accessors?.selection?.getActiveCell?.() ?? null;
  const ranges = deps.accessors?.selection?.getRanges?.() ?? [];
  if (
    activeCell &&
    ranges.length === 1 &&
    ranges[0].startRow === ranges[0].endRow &&
    ranges[0].startCol === ranges[0].endCol
  ) {
    const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
    const cell = await ws.getCell(activeCell.row, activeCell.col);
    if (typeof cell?.formula === 'string' && cell.formula.length > 0) {
      setCell = toA1(activeCell.row, activeCell.col);
    }
  }

  getUIStore(deps)
    .getState()
    .openGoalSeekDialog(setCell ? { setCell } : undefined);
  return { handled: true };
};

/**
 * Close Goal Seek dialog
 */
export const CLOSE_GOAL_SEEK_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeGoalSeekDialog();
  return { handled: true };
};

/**
 * Execute Goal Seek algorithm
 *
 * Finds the input value (changing cell) that makes a formula (set cell)
 * equal to the target value. Delegates to the Rust compute-core solver via
 * `ws.whatIf.goalSeek` (Brent's method with secant fallback).
 */
export const EXECUTE_GOAL_SEEK: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const { setCell, toValue, byChangingCell } = state.goalSeekDialog;

  const targetValue = Number(toValue);
  if (!Number.isFinite(targetValue)) {
    state.setGoalSeekResult({
      found: false,
      iterations: 0,
      errorMessage: `Invalid target value: "${toValue}"`,
    });
    return { handled: true };
  }

  state.setGoalSeekStatus('running');

  try {
    const ws = deps.workbook.getSheetById(state.activeSheetId);
    const result = await ws.whatIf.goalSeek(setCell, targetValue, byChangingCell);
    let achievedValue = result.value;
    try {
      const setPos = parseA1(setCell.toUpperCase());
      const targetCell = await ws.getCell(setPos.row, setPos.col);
      const targetCellValue = targetCell?.value;
      if (typeof targetCellValue === 'number' && Number.isFinite(targetCellValue)) {
        achievedValue = targetCellValue;
      }
    } catch {
      // Keep the solver result if the target cell cannot be read as a finite raw numeric value.
    }
    state.setGoalSeekResult({
      found: result.found,
      solutionValue: result.value,
      achievedValue,
      iterations: result.iterations ?? 0,
    });
  } catch (err) {
    state.setGoalSeekResult({
      found: false,
      iterations: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return { handled: true };
};

/**
 * Apply Goal Seek result - write the solution value to the changing cell
 *
 * Unified API: Migrated from sync setCellValue(ctx, ...) to async ws.setCell().
 */
export const APPLY_GOAL_SEEK_RESULT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const { byChangingCell, result } = state.goalSeekDialog;

  // Validate we have a result to apply
  if (!result || !result.found || result.solutionValue === undefined) {
    return { handled: true, error: 'No valid solution to apply' };
  }

  // Parse changing cell reference
  let changingPos: { row: number; col: number };
  try {
    changingPos = parseA1(byChangingCell.toUpperCase());
  } catch {
    return { handled: true, error: 'Invalid cell reference' };
  }

  // Get current sheet
  const sheetId = state.activeSheetId;

  // Apply the solution value via unified Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const ok = await guardBridgeMutation(() =>
    ws.setCell(changingPos.row, changingPos.col, String(result.solutionValue)),
  );
  if (!ok) return { handled: true };

  // Close the dialog
  state.closeGoalSeekDialog();

  return { handled: true };
};

/**
 * Cancel Goal Seek operation
 */
export const CANCEL_GOAL_SEEK: ActionHandler = (deps): ActionResult => {
  const state = getUIStore(deps).getState();
  state.setGoalSeekStatus('idle');
  state.setGoalSeekResult(null);
  return { handled: true };
};

export const OPEN_FORECAST_SHEET_DIALOG: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const activeCell = deps.accessors?.selection?.getActiveCell?.() ?? null;
  const ranges = deps.accessors?.selection?.getRanges?.() ?? [];
  const rangeLabel =
    ranges.length === 1
      ? `${toA1(ranges[0].startRow, ranges[0].startCol)}:${toA1(ranges[0].endRow, ranges[0].endCol)}`
      : activeCell
        ? toA1(activeCell.row, activeCell.col)
        : 'the selected range';

  await deps.platform.dialogs.alert(
    `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
    { type: 'info' },
  );
  return { handled: true };
};

// =============================================================================
// Consolidate Dialog Handlers
// =============================================================================

/**
 * Open Consolidate dialog
 */
export const OPEN_CONSOLIDATE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openConsolidateDialog();
  return { handled: true };
};

/**
 * Close Consolidate dialog
 */
export const CLOSE_CONSOLIDATE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeConsolidateDialog();
  return { handled: true };
};

/**
 * Execute Consolidation
 * Note: Actual consolidation would be implemented in a domain module
 */
export const EXECUTE_CONSOLIDATE: ActionHandler = (_deps): ActionResult => {
  // TODO: Implement actual consolidation via domain module
  return { handled: false, reason: 'not_implemented' };
};

// =============================================================================
// Spelling Dialog Handlers
// =============================================================================

const SPELLING_SUGGESTIONS: Record<string, string[]> = {
  mispeling: ['misspelling', 'spelling'],
  mispelled: ['misspelled'],
  teh: ['the'],
  recieve: ['receive'],
  seperate: ['separate'],
  occured: ['occurred'],
  untill: ['until'],
  adress: ['address'],
};

function scanTextForSpellingErrors(
  text: string,
  sheetId: string,
  row: number,
  col: number,
  ignoredWords: Set<string>,
): SpellingError[] {
  const errors: SpellingError[] = [];
  const wordPattern = /[A-Za-z][A-Za-z']*/g;
  for (const match of text.matchAll(wordPattern)) {
    const word = match[0];
    const key = word.toLowerCase();
    if (!SPELLING_SUGGESTIONS[key] || ignoredWords.has(key)) continue;
    errors.push({
      word,
      suggestions: SPELLING_SUGGESTIONS[key],
      sheetId,
      row,
      col,
      startIndex: match.index ?? 0,
      length: word.length,
    });
  }
  return errors;
}

function replaceSpan(value: string, error: SpellingError, replacement: string): string {
  return (
    value.slice(0, error.startIndex) + replacement + value.slice(error.startIndex + error.length)
  );
}

/**
 * Open Spelling dialog and start spell check
 */
export const OPEN_SPELLING_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  state.openSpellingDialog();

  const sheetId = state.activeSheetId;
  const ws = deps.workbook.getSheetById(sheetId);
  const ignoredWords = state.spellingDialog.ignoredWords;
  const usedRange = await ws.getUsedRange();

  if (!usedRange) {
    store.getState().setSpellingErrors([]);
    return { handled: true };
  }

  const errors: SpellingError[] = [];
  for (let row = usedRange.startRow; row <= usedRange.endRow; row += 1) {
    for (let col = usedRange.startCol; col <= usedRange.endCol; col += 1) {
      const cell = await ws.getCell(row, col);
      const value = cell?.value;
      if (typeof value !== 'string' || value.startsWith('=')) continue;
      errors.push(...scanTextForSpellingErrors(value, sheetId, row, col, ignoredWords));
    }
  }

  store.getState().setSpellingErrors(errors);
  return { handled: true };
};

/**
 * Close Spelling dialog
 */
export const CLOSE_SPELLING_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeSpellingDialog();
  return { handled: true };
};

/**
 * Move to next spelling error
 */
export const SPELL_CHECK_NEXT: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().nextSpellingError();
  return { handled: true };
};

/**
 * Change current misspelled word to suggestion
 */
export const SPELL_CHECK_CHANGE: AsyncActionHandler = async (
  deps,
  payload?: { replacement?: string },
): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const error = state.spellingDialog.currentError;
  const replacement = payload?.replacement ?? state.spellingDialog.customReplacement;
  if (!error || !replacement.trim()) return { handled: true };

  const targetSheetId = sheetId(error.sheetId);
  const ws = deps.workbook.getSheetById(targetSheetId);
  const cell = await ws.getCell(error.row, error.col);
  const value = typeof cell?.value === 'string' ? cell.value : '';
  await ws.setCell(error.row, error.col, replaceSpan(value, error, replacement));
  requestFormulaBarRefresh({
    sheetIds: [targetSheetId],
    ranges: [
      {
        startRow: error.row,
        startCol: error.col,
        endRow: error.row,
        endCol: error.col,
      },
    ],
  });
  store.getState().resolveCurrentSpellingError();
  return { handled: true };
};

/**
 * Change all occurrences of misspelled word
 */
export const SPELL_CHECK_CHANGE_ALL: AsyncActionHandler = async (
  deps,
  payload?: { replacement?: string },
): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const current = state.spellingDialog.currentError;
  const replacement = payload?.replacement ?? state.spellingDialog.customReplacement;
  if (!current || !replacement.trim()) return { handled: true };

  const targetWord = current.word.toLowerCase();
  const matchingErrors = state.spellingDialog.errors.filter(
    (error) => error.word.toLowerCase() === targetWord,
  );
  const errorsByCell = new Map<string, SpellingError[]>();
  for (const error of matchingErrors) {
    const key = `${error.sheetId}:${error.row}:${error.col}`;
    errorsByCell.set(key, [...(errorsByCell.get(key) ?? []), error]);
  }

  for (const cellErrors of errorsByCell.values()) {
    const first = cellErrors[0];
    const targetSheetId = sheetId(first.sheetId);
    const ws = deps.workbook.getSheetById(targetSheetId);
    const cell = await ws.getCell(first.row, first.col);
    let value = typeof cell?.value === 'string' ? cell.value : '';
    for (const error of [...cellErrors].sort((a, b) => b.startIndex - a.startIndex)) {
      value = replaceSpan(value, error, replacement);
    }
    await ws.setCell(first.row, first.col, value);
    requestFormulaBarRefresh({
      sheetIds: [targetSheetId],
      ranges: [
        {
          startRow: first.row,
          startCol: first.col,
          endRow: first.row,
          endCol: first.col,
        },
      ],
    });
  }

  store.getState().ignoreAllSpellingWord();
  for (let i = 0; i < matchingErrors.length; i += 1) {
    store.getState().incrementSpellingChangesCount();
  }
  return { handled: true };
};

/**
 * Ignore current spelling error
 */
export const SPELL_CHECK_IGNORE: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().ignoreSpellingWord();
  return { handled: true };
};

/**
 * Ignore all occurrences of the misspelled word
 */
export const SPELL_CHECK_IGNORE_ALL: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().ignoreAllSpellingWord();
  return { handled: true };
};

/**
 * Add current word to dictionary
 */
export const SPELL_CHECK_ADD_TO_DICTIONARY: ActionHandler = (_deps): ActionResult => {
  // TODO: Implement custom dictionary storage
  return { handled: false, reason: 'not_implemented' };
};

// =============================================================================
// Watch Window Handlers
// =============================================================================

/**
 * Open Watch Window
 */
export const OPEN_WATCH_WINDOW: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openWatchWindow();
  return { handled: true };
};

/**
 * Close Watch Window
 */
export const CLOSE_WATCH_WINDOW: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeWatchWindow();
  return { handled: true };
};

/**
 * Toggle Watch Window visibility
 */
export const TOGGLE_WATCH_WINDOW: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleWatchWindow();
  return { handled: true };
};

/**
 * Add a cell to the watch window
 */
export const ADD_WATCH: ActionHandler = (deps, payload): ActionResult => {
  if (!payload?.sheetId || payload?.row === undefined || payload?.col === undefined) {
    return { handled: false, error: 'Missing watch entry data' };
  }

  getUIStore(deps)
    .getState()
    .addWatch({
      sheetId: payload.sheetId,
      sheetName: payload.sheetName || 'Sheet1',
      cellRef: payload.cellRef || '',
      row: payload.row,
      col: payload.col,
      value: payload.value,
      formula: payload.formula ?? null,
    });
  return { handled: true };
};

/**
 * Delete selected watch entries
 */
export const DELETE_WATCH: ActionHandler = (deps): ActionResult => {
  const state = getUIStore(deps).getState();
  const selectedIds = Array.from(state.watchWindow.selectedWatchIds);
  if (selectedIds.length > 0) {
    state.removeWatches(selectedIds);
  }
  return { handled: true };
};

/**
 * Delete all watch entries
 */
export const DELETE_ALL_WATCHES: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().clearAllWatches();
  return { handled: true };
};

// =============================================================================
// Error Checking Dialog Handlers
// =============================================================================

/**
 * Open Error Checking dialog
 */
export const OPEN_ERROR_CHECKING_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openErrorCheckingDialog();
  return { handled: true };
};

/**
 * Close Error Checking dialog
 */
export const CLOSE_ERROR_CHECKING_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeErrorCheckingDialog();
  return { handled: true };
};

/**
 * Navigate to next error
 */
export const ERROR_CHECK_NEXT: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().nextFormulaError();
  return { handled: true };
};

/**
 * Navigate to previous error
 */
export const ERROR_CHECK_PREVIOUS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().previousFormulaError();
  return { handled: true };
};

/**
 * Ignore current error
 */
export const ERROR_CHECK_IGNORE: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().ignoreCurrentError();
  return { handled: true };
};

/**
 * Open formula bar to edit current error cell
 */
export const ERROR_CHECK_EDIT_IN_FORMULA_BAR: ActionHandler = (_deps): ActionResult => {
  // TODO: Navigate to error cell and start editing
  return { handled: false, reason: 'not_implemented' };
};

// =============================================================================
// Evaluate Formula Dialog Handlers
// =============================================================================

/**
 * Open Evaluate Formula dialog for current cell
 */
export const OPEN_EVALUATE_FORMULA_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  if (
    !payload?.sheetId ||
    payload?.row === undefined ||
    payload?.col === undefined ||
    !payload?.formula
  ) {
    return { handled: false, error: 'Missing formula evaluation data' };
  }

  getUIStore(deps)
    .getState()
    .openEvaluateFormulaDialog({
      sheetId: payload.sheetId,
      row: payload.row,
      col: payload.col,
      cellRef: payload.cellRef || '',
      formula: payload.formula,
    });
  return { handled: true };
};

/**
 * Close Evaluate Formula dialog
 */
export const CLOSE_EVALUATE_FORMULA_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeEvaluateFormulaDialog();
  return { handled: true };
};

/**
 * Evaluate next step in formula
 */
export const EVALUATE_NEXT_STEP: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().evaluateNext();
  return { handled: true };
};

/**
 * Step into nested expression
 */
export const EVALUATE_STEP_IN: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().stepInto();
  return { handled: true };
};

/**
 * Step out of nested expression
 */
export const EVALUATE_STEP_OUT: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().stepOut();
  return { handled: true };
};

/**
 * Restart formula evaluation
 */
export const EVALUATE_RESTART: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().restartEvaluation();
  return { handled: true };
};

// =============================================================================
// Data Table Dialog Handlers
// =============================================================================

/**
 * Open Data Table dialog
 */
export const OPEN_DATA_TABLE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openDataTableDialog();
  return { handled: true };
};

/**
 * Close Data Table dialog
 */
export const CLOSE_DATA_TABLE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeDataTableDialog();
  return { handled: true };
};

/**
 * Execute Data Table creation through the production worksheet API.
 */
export const EXECUTE_DATA_TABLE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const state = getUIStore(deps).getState();
  const { rowInputCellRef, colInputCellRef } = state.dataTableDialog;

  state.setDataTableStatus('running', 0);

  const started = performance.now();
  try {
    if (!rowInputCellRef.trim() && !colInputCellRef.trim()) {
      throw new Error('At least one input cell is required.');
    }

    const ranges = deps.accessors.selection.getRanges();
    if (ranges.length !== 1) {
      throw new Error('Select exactly one Data Table range before creating the table.');
    }

    const range = ranges[0];
    const startRow = Math.min(range.startRow, range.endRow);
    const startCol = Math.min(range.startCol, range.endCol);
    const endRow = Math.max(range.startRow, range.endRow);
    const endCol = Math.max(range.startCol, range.endCol);

    const sheetId = deps.getActiveSheetId();
    const ws = deps.workbook.getSheetById(sheetId);
    const toPrimitiveCellValue = (value: CellValue): CellValuePrimitive => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        value.type === 'error'
      ) {
        return value.value;
      }
      return value as CellValuePrimitive;
    };
    const readCellValue = async (row: number, col: number): Promise<CellValuePrimitive> => {
      const cell = await ws.getCell(row, col);
      return toPrimitiveCellValue(
        ((cell as { value?: CellValue } | null)?.value ?? null) as CellValue,
      );
    };

    const rowInput = rowInputCellRef.trim() || null;
    const colInput = colInputCellRef.trim() || null;
    let result: { results: CellValue[][]; cellCount?: number; cancelled?: boolean };
    const writes: Array<{ row: number; col: number; value: CellValuePrimitive }> = [];

    if (rowInput && colInput) {
      if (endRow <= startRow || endCol <= startCol) {
        throw new Error(
          'Two-variable Data Tables require a formula corner, top row, and left column.',
        );
      }

      const topRowValues = await Promise.all(
        Array.from({ length: endCol - startCol }, (_, offset) =>
          readCellValue(startRow, startCol + 1 + offset),
        ),
      );
      const leftColumnValues = await Promise.all(
        Array.from({ length: endRow - startRow }, (_, offset) =>
          readCellValue(startRow + 1 + offset, startCol),
        ),
      );

      result = await ws.whatIf.dataTable(toA1(startRow, startCol), {
        // Excel row input consumes top-row values; the legacy evaluator's
        // rowValues dimension is output rows, so the two axes are swapped here.
        rowInputCell: colInput,
        colInputCell: rowInput,
        rowValues: leftColumnValues,
        colValues: topRowValues,
      });

      for (let rowIndex = 0; rowIndex < result.results.length; rowIndex++) {
        for (let colIndex = 0; colIndex < (result.results[rowIndex]?.length ?? 0); colIndex++) {
          writes.push({
            row: startRow + 1 + rowIndex,
            col: startCol + 1 + colIndex,
            value: toPrimitiveCellValue(result.results[rowIndex][colIndex]),
          });
        }
      }
    } else if (colInput) {
      if (endRow <= startRow) {
        throw new Error(
          'Column-input Data Tables require at least one substitution value below the formula cell.',
        );
      }

      const leftColumnValues = await Promise.all(
        Array.from({ length: endRow - startRow }, (_, offset) =>
          readCellValue(startRow + 1 + offset, startCol),
        ),
      );

      result = await ws.whatIf.dataTable(toA1(startRow, startCol), {
        rowInputCell: colInput,
        colInputCell: null,
        rowValues: leftColumnValues,
        colValues: [],
      });

      for (let rowIndex = 0; rowIndex < result.results.length; rowIndex++) {
        writes.push({
          row: startRow + 1 + rowIndex,
          col: startCol,
          value: toPrimitiveCellValue(result.results[rowIndex]?.[0] ?? null),
        });
      }
    } else if (rowInput) {
      if (endCol <= startCol) {
        throw new Error(
          'Row-input Data Tables require at least one substitution value to the right of the formula cell.',
        );
      }

      const topRowValues = await Promise.all(
        Array.from({ length: endCol - startCol }, (_, offset) =>
          readCellValue(startRow, startCol + 1 + offset),
        ),
      );

      result = await ws.whatIf.dataTable(toA1(startRow, startCol), {
        rowInputCell: null,
        colInputCell: rowInput,
        rowValues: [],
        colValues: topRowValues,
      });

      for (let colIndex = 0; colIndex < (result.results[0]?.length ?? 0); colIndex++) {
        writes.push({
          row: startRow,
          col: startCol + 1 + colIndex,
          value: toPrimitiveCellValue(result.results[0][colIndex]),
        });
      }
    } else {
      throw new Error('At least one input cell is required.');
    }

    if (writes.length > 0) {
      await ws.setCells(writes);
    }

    state.setDataTableResult({
      cellCount: result.cellCount ?? writes.length,
      elapsedMs: performance.now() - started,
      cancelled: false,
    });
  } catch (err) {
    state.setDataTableResult({
      cellCount: 0,
      elapsedMs: performance.now() - started,
      cancelled: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return { handled: true };
};

/**
 * Cancel Data Table operation
 */
export const CANCEL_DATA_TABLE: ActionHandler = (deps): ActionResult => {
  const state = getUIStore(deps).getState();
  state.setDataTableStatus('cancelled');
  state.setDataTableResult(null);
  return { handled: true };
};

// =============================================================================
// Scenario Manager Dialog Handlers
// =============================================================================

/**
 * Open Scenario Manager dialog
 */
export const OPEN_SCENARIO_MANAGER_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openScenarioManagerDialog();
  return { handled: true };
};

/**
 * Close Scenario Manager dialog
 */
export const CLOSE_SCENARIO_MANAGER_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeScenarioManagerDialog();
  return { handled: true };
};

/**
 * Create a new scenario
 *
 * Note: The actual scenario creation is performed by the dialog component.
 * This handler manages the UI state.
 */
export const CREATE_SCENARIO: ActionHandler = (_deps): ActionResult => {
  // The dialog component handles the actual creation via Scenarios.create()
  // This handler is a placeholder for potential pre-creation validation
  return { handled: true };
};

/**
 * Update an existing scenario
 *
 * Note: The actual scenario update is performed by the dialog component.
 */
export const UPDATE_SCENARIO: ActionHandler = (_deps): ActionResult => {
  // The dialog component handles the actual update via Scenarios.update()
  return { handled: true };
};

/**
 * Delete a scenario
 *
 * Note: The actual scenario deletion is performed by the dialog component.
 */
export const DELETE_SCENARIO: ActionHandler = (_deps): ActionResult => {
  // The dialog component handles the actual deletion via Scenarios.remove()
  return { handled: true };
};

/**
 * Apply a scenario (show its values in the sheet)
 *
 * Note: The actual scenario application is performed by the dialog component.
 * This handler manages the UI state.
 */
export const APPLY_SCENARIO: ActionHandler = (deps): ActionResult => {
  // Set processing state - actual application is done by the dialog component
  getUIStore(deps).getState().setProcessing(true);
  return { handled: true };
};

/**
 * Restore original values (remove applied scenario)
 *
 * Note: The actual restoration is performed by the dialog component.
 */
export const RESTORE_ORIGINAL_VALUES: ActionHandler = (deps): ActionResult => {
  // Set processing state - actual restoration is done by the dialog component
  getUIStore(deps).getState().setProcessing(true);
  return { handled: true };
};
