/**
 * Data Analysis Dialog Action Handlers
 *
 * Handlers for Goal Seek, Consolidate, Spelling, Watch Window,
 * Error Checking, and Evaluate Formula dialogs.
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
import { parseA1, parseA1Range, toA1 } from '@mog/spreadsheet-utils/a1';
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
    // Use achievedValue directly from the solver result (the formula cell value
    // at the solution point). We no longer re-read the target cell from the sheet
    // because the solver no longer writes to the changing cell as a side-effect —
    // the cell value in the sheet hasn't changed yet at this point.
    state.setGoalSeekResult({
      found: result.found,
      solutionValue: result.value,
      achievedValue: result.achievedValue,
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

/**
 * Detect whether a numeric value looks like an Excel date serial number.
 * Excel serials for dates between 1900-01-01 (1) and 2200-01-01 (~109574)
 * are accepted. Values must be positive integers or close to integers.
 */
function looksLikeDateSerial(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return v >= 1 && v <= 120000 && Math.abs(v - Math.round(v)) < 0.0001;
}

/**
 * Convert an Excel date serial number to an ISO date string (YYYY-MM-DD).
 * Uses the 1900 date system (serial 1 = 1900-01-01, with the Lotus 1-2-3
 * Feb 29 1900 bug accounted for).
 */
function serialToISODate(serial: number): string {
  // Excel epoch: serial 1 = 1900-01-01.
  // JS Date epoch: 1970-01-01 = serial 25569.
  // Account for the Lotus bug: serials > 59 are off by 1.
  const adjusted = serial > 59 ? serial - 1 : serial;
  const ms = (adjusted - 25569) * 86400000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert an ISO date string back to an Excel serial number.
 */
function isoDateToSerial(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z');
  const serial = Math.round(d.getTime() / 86400000 + 25569);
  return serial > 59 ? serial + 1 : serial;
}

/**
 * Simple linear regression: returns slope and intercept for y = slope*x + intercept.
 */
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    return { slope: 0, intercept: sumY / n };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

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

  // ── Step 1: Read selected range data ──────────────────────────────
  if (ranges.length !== 1) {
    await deps.platform.dialogs.alert(
      `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
      { type: 'info' },
    );
    return { handled: true };
  }

  const range = ranges[0];
  const startRow = Math.min(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endRow = Math.max(range.startRow, range.endRow);
  const endCol = Math.max(range.startCol, range.endCol);
  const numCols = endCol - startCol + 1;
  const numRows = endRow - startRow + 1;

  if (numCols < 2 || numRows < 4) {
    await deps.platform.dialogs.alert(
      `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
      { type: 'info' },
    );
    return { handled: true };
  }

  const activeSheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(activeSheetId);

  // Read all cell values from the selected range
  const data: Array<{ value: unknown; formula: string | null }>[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: Array<{ value: unknown; formula: string | null }> = [];
    for (let c = startCol; c <= endCol; c++) {
      const cell = await ws.getCell(r, c);
      row.push({
        value: cell?.value ?? null,
        formula: typeof cell?.formula === 'string' ? cell.formula : null,
      });
    }
    data.push(row);
  }

  // ── Step 2: Identify date column and value column ─────────────────
  // Check if row 0 is a header row (contains strings)
  const hasHeader = data[0].some(
    (cell) => typeof cell.value === 'string' && !/^\d+$/.test(cell.value),
  );
  const dataStartIdx = hasHeader ? 1 : 0;
  const dataRows = data.slice(dataStartIdx);

  if (dataRows.length < 3) {
    await deps.platform.dialogs.alert(
      `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
      { type: 'info' },
    );
    return { handled: true };
  }

  // Find which column has date serials and which has numeric values
  let dateColIdx = -1;
  let valueColIdx = -1;

  for (let c = 0; c < numCols; c++) {
    const colValues = dataRows.map((row) => row[c].value);
    const dateCount = colValues.filter((v) => looksLikeDateSerial(v)).length;
    const numCount = colValues.filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && !looksLikeDateSerial(v),
    ).length;

    if (dateCount >= dataRows.length * 0.8 && dateColIdx === -1) {
      dateColIdx = c;
    } else if (numCount >= dataRows.length * 0.8 && valueColIdx === -1) {
      valueColIdx = c;
    }
  }

  // If we couldn't separate date vs numeric by the heuristic above,
  // try: first column = date, second column = numeric
  if (dateColIdx === -1 || valueColIdx === -1) {
    const col0Dates = dataRows.filter((row) => looksLikeDateSerial(row[0].value)).length;
    const col1Nums = dataRows.filter(
      (row) => typeof row[1]?.value === 'number' && Number.isFinite(row[1]?.value as number),
    ).length;
    if (col0Dates >= dataRows.length * 0.7 && col1Nums >= dataRows.length * 0.7) {
      dateColIdx = 0;
      valueColIdx = 1;
    }
  }

  if (dateColIdx === -1 || valueColIdx === -1) {
    await deps.platform.dialogs.alert(
      `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
      { type: 'info' },
    );
    return { handled: true };
  }

  // ── Step 3: Extract time series and run forecast ──────────────────
  const dateSerials: number[] = [];
  const values: number[] = [];
  for (const row of dataRows) {
    const d = row[dateColIdx].value;
    const v = row[valueColIdx].value;
    if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      dateSerials.push(Math.round(d));
      values.push(v);
    }
  }

  if (dateSerials.length < 3) {
    await deps.platform.dialogs.alert(
      `Forecast Sheet needs a selected time series with date/time values and numeric values. Current selection: ${rangeLabel}.`,
      { type: 'info' },
    );
    return { handled: true };
  }

  // Compute average step between dates for forecasting period
  const steps: number[] = [];
  for (let i = 1; i < dateSerials.length; i++) {
    steps.push(dateSerials[i] - dateSerials[i - 1]);
  }
  const avgStep = steps.reduce((a, b) => a + b, 0) / steps.length;
  const forecastPeriods = Math.max(3, Math.round(dateSerials.length * 0.5));

  // Linear regression on (dateSerial, value)
  const { slope, intercept } = linearRegression(dateSerials, values);

  // Compute standard error for confidence intervals
  let ssResidual = 0;
  for (let i = 0; i < dateSerials.length; i++) {
    const predicted = slope * dateSerials[i] + intercept;
    ssResidual += (values[i] - predicted) ** 2;
  }
  const stdError = dateSerials.length > 2
    ? Math.sqrt(ssResidual / (dateSerials.length - 2))
    : 0;
  const confidenceZ = 1.96; // 95% confidence

  // Generate forecast rows
  const forecastDateSerials: number[] = [];
  const forecastValues: number[] = [];
  const forecastLower: number[] = [];
  const forecastUpper: number[] = [];
  const lastSerial = dateSerials[dateSerials.length - 1];
  for (let i = 1; i <= forecastPeriods; i++) {
    const serial = Math.round(lastSerial + avgStep * i);
    const predicted = slope * serial + intercept;
    forecastDateSerials.push(serial);
    forecastValues.push(Math.round(predicted * 100) / 100);
    forecastLower.push(Math.round((predicted - confidenceZ * stdError) * 100) / 100);
    forecastUpper.push(Math.round((predicted + confidenceZ * stdError) * 100) / 100);
  }

  // ── Step 4: Create new forecast worksheet ─────────────────────────
  const headers = hasHeader ? data[0] : null;
  const dateHeader = headers ? String(headers[dateColIdx].value ?? 'Date') : 'Date';
  const valueHeader = headers ? String(headers[valueColIdx].value ?? 'Value') : 'Value';

  const forecastSheet = await deps.workbook.sheets.add('Forecast');

  // Build cells to write
  const cellsToWrite: Array<{ row: number; col: number; value: string | number }> = [];

  // Row 0: Headers
  cellsToWrite.push({ row: 0, col: 0, value: dateHeader });
  cellsToWrite.push({ row: 0, col: 1, value: valueHeader });
  cellsToWrite.push({ row: 0, col: 2, value: 'Forecast' });
  cellsToWrite.push({ row: 0, col: 3, value: 'Lower Confidence Bound' });
  cellsToWrite.push({ row: 0, col: 4, value: 'Upper Confidence Bound' });

  // Historical data rows
  let currentRow = 1;
  for (let i = 0; i < dateSerials.length; i++) {
    const isoDate = serialToISODate(dateSerials[i]);
    cellsToWrite.push({ row: currentRow, col: 0, value: isoDate });
    cellsToWrite.push({ row: currentRow, col: 1, value: values[i] });
    currentRow++;
  }

  // Forecast data rows
  for (let i = 0; i < forecastPeriods; i++) {
    const isoDate = serialToISODate(forecastDateSerials[i]);
    cellsToWrite.push({ row: currentRow, col: 0, value: isoDate });
    cellsToWrite.push({ row: currentRow, col: 2, value: forecastValues[i] });
    cellsToWrite.push({ row: currentRow, col: 3, value: forecastLower[i] });
    cellsToWrite.push({ row: currentRow, col: 4, value: forecastUpper[i] });
    currentRow++;
  }

  // Metadata row: timeline summary
  currentRow++;
  cellsToWrite.push({ row: currentRow, col: 0, value: 'Forecast Summary' });
  cellsToWrite.push({
    row: currentRow + 1,
    col: 0,
    value: `Timeline: ${serialToISODate(dateSerials[0])} to ${serialToISODate(forecastDateSerials[forecastDateSerials.length - 1])}`,
  });
  cellsToWrite.push({
    row: currentRow + 2,
    col: 0,
    value: `Confidence Level: 95%`,
  });
  cellsToWrite.push({
    row: currentRow + 3,
    col: 0,
    value: `Seasonality: auto`,
  });

  // Write all cells to the forecast sheet
  for (const cell of cellsToWrite) {
    await forecastSheet.setCell(cell.row, cell.col, cell.value as any);
  }

  // Set the forecast sheet as active
  await deps.workbook.sheets.setActive('Forecast');

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
 *
 * Reads source ranges, applies the selected aggregation function, and writes
 * results into the destination range. Supports:
 * - Plain value consolidation (no labels): positional merge of same-shaped ranges
 * - Top row / left column label matching: align by label text, union of all labels
 * - Create links: write formulas referencing source cells instead of static values
 */
export const EXECUTE_CONSOLIDATE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const dialog = state.consolidateDialog;

  if (dialog.sourceReferences.length === 0) {
    return { handled: true, error: 'No source references provided' };
  }

  const sheetIdVal = state.activeSheetId;
  const ws = deps.workbook.getSheetById(sheetIdVal);

  // Parse the destination from the dialog state or fall back to active cell
  let destRow: number;
  let destCol: number;
  const destRef = dialog.destination;
  if (destRef) {
    const parsed = parseA1(destRef.toUpperCase());
    destRow = parsed.row;
    destCol = parsed.col;
  } else {
    const activeCell = deps.accessors?.selection?.getActiveCell?.() ?? null;
    if (!activeCell) return { handled: true, error: 'No destination cell' };
    destRow = activeCell.row;
    destCol = activeCell.col;
  }

  // Parse source ranges
  const sourceRanges: Array<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  }> = [];

  for (const ref of dialog.sourceReferences) {
    const range = parseA1Range(ref.reference.toUpperCase());
    sourceRanges.push(range);
  }

  // Read all source data
  const sourceData: Array<Array<Array<string>>> = [];
  for (const range of sourceRanges) {
    const rows: string[][] = [];
    for (let r = range.startRow; r <= range.endRow; r++) {
      const row: string[] = [];
      for (let c = range.startCol; c <= range.endCol; c++) {
        const cell = await ws.getCell(r, c);
        const val = cell?.value;
        row.push(val != null ? String(val) : '');
      }
      rows.push(row);
    }
    sourceData.push(rows);
  }

  const aggFn = dialog.func;
  const useTopRow = dialog.useTopRowLabels;
  const useLeftCol = dialog.useLeftColumnLabels;
  const createLinks = dialog.createLinks;

  type CellWrite = { row: number; col: number; value: string };
  const writes: CellWrite[] = [];

  // Aggregate function helper
  function aggregate(values: number[]): number {
    if (values.length === 0) return 0;
    switch (aggFn) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'count':
        return values.length;
      case 'average':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'max':
        return Math.max(...values);
      case 'min':
        return Math.min(...values);
      case 'product':
        return values.reduce((a, b) => a * b, 1);
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  if (useTopRow || useLeftCol) {
    // Label-based consolidation
    const allColLabels: string[] = [];
    const allRowLabels: string[] = [];
    const sourceParsed: Array<{
      colLabels: string[];
      rowLabels: string[];
      data: Map<string, number>;
      positions: Map<string, { rangeIdx: number; row: number; col: number }>;
    }> = [];

    for (let si = 0; si < sourceData.length; si++) {
      const grid = sourceData[si];
      const range = sourceRanges[si];
      const colLabels: string[] = [];
      const rowLabels: string[] = [];
      const data = new Map<string, number>();
      const positions = new Map<string, { rangeIdx: number; row: number; col: number }>();
      const dataStartRow = useTopRow ? 1 : 0;
      const dataStartCol = useLeftCol ? 1 : 0;

      if (useTopRow && grid.length > 0) {
        for (let c = dataStartCol; c < grid[0].length; c++) {
          const label = grid[0][c].trim();
          colLabels.push(label);
          if (!allColLabels.includes(label)) allColLabels.push(label);
        }
      }
      if (useLeftCol) {
        for (let r = dataStartRow; r < grid.length; r++) {
          const label = grid[r][0].trim();
          rowLabels.push(label);
          if (!allRowLabels.includes(label)) allRowLabels.push(label);
        }
      }

      if (!useTopRow) {
        for (let c = dataStartCol; c < (grid[0]?.length ?? 0); c++) {
          const label = `__col_${c}`;
          colLabels.push(label);
          if (!allColLabels.includes(label)) allColLabels.push(label);
        }
      }
      if (!useLeftCol) {
        for (let r = dataStartRow; r < grid.length; r++) {
          const label = `__row_${r}`;
          rowLabels.push(label);
          if (!allRowLabels.includes(label)) allRowLabels.push(label);
        }
      }

      for (let ri = 0; ri < rowLabels.length; ri++) {
        for (let ci = 0; ci < colLabels.length; ci++) {
          const r = dataStartRow + ri;
          const c = dataStartCol + ci;
          if (r < grid.length && c < grid[r].length) {
            const val = parseFloat(grid[r][c]);
            if (!isNaN(val)) {
              const key = `${rowLabels[ri]}|${colLabels[ci]}`;
              data.set(key, val);
              positions.set(key, {
                rangeIdx: si,
                row: range.startRow + r,
                col: range.startCol + c,
              });
            }
          }
        }
      }
      sourceParsed.push({ colLabels, rowLabels, data, positions });
    }

    // Write output table
    const outStartRow = destRow;
    const outStartCol = destCol;
    const headerRowOffset = useTopRow ? 1 : 0;
    const headerColOffset = useLeftCol ? 1 : 0;

    if (useTopRow) {
      for (let ci = 0; ci < allColLabels.length; ci++) {
        writes.push({
          row: outStartRow,
          col: outStartCol + headerColOffset + ci,
          value: allColLabels[ci],
        });
      }
    }

    if (useLeftCol) {
      for (let ri = 0; ri < allRowLabels.length; ri++) {
        writes.push({
          row: outStartRow + headerRowOffset + ri,
          col: outStartCol,
          value: allRowLabels[ri],
        });
      }
    }

    for (let ri = 0; ri < allRowLabels.length; ri++) {
      for (let ci = 0; ci < allColLabels.length; ci++) {
        const key = `${allRowLabels[ri]}|${allColLabels[ci]}`;
        const values: number[] = [];
        const cellRefs: string[] = [];
        for (const sp of sourceParsed) {
          const val = sp.data.get(key);
          if (val !== undefined) {
            values.push(val);
            const pos = sp.positions.get(key);
            if (pos) {
              cellRefs.push(toA1(pos.row, pos.col));
            }
          }
        }

        const outR = outStartRow + headerRowOffset + ri;
        const outC = outStartCol + headerColOffset + ci;

        if (createLinks && cellRefs.length > 0) {
          const formula = `=${cellRefs.join('+')}`;
          writes.push({ row: outR, col: outC, value: formula });
        } else {
          const result = aggregate(values);
          writes.push({ row: outR, col: outC, value: String(result) });
        }
      }
    }
  } else {
    // Positional consolidation (no labels)
    const firstRange = sourceRanges[0];
    const numRows = firstRange.endRow - firstRange.startRow + 1;
    const numCols = firstRange.endCol - firstRange.startCol + 1;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const values: number[] = [];
        const cellRefs: string[] = [];
        for (let si = 0; si < sourceData.length; si++) {
          const grid = sourceData[si];
          if (r < grid.length && c < grid[r].length) {
            const val = parseFloat(grid[r][c]);
            if (!isNaN(val)) {
              values.push(val);
              const range = sourceRanges[si];
              cellRefs.push(toA1(range.startRow + r, range.startCol + c));
            }
          }
        }

        if (createLinks && cellRefs.length > 0) {
          const formula = `=${cellRefs.join('+')}`;
          writes.push({ row: destRow + r, col: destCol + c, value: formula });
        } else {
          const result = aggregate(values);
          writes.push({ row: destRow + r, col: destCol + c, value: String(result) });
        }
      }
    }
  }

  if (writes.length > 0) {
    await ws.setCells(writes);
  }

  store.getState().closeConsolidateDialog();
  return { handled: true };
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
