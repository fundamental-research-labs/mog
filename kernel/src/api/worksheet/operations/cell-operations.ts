/**
 * Cell Operations Module
 *
 * Standalone functions for cell read/write operations.
 * Extracted from SheetAPI for modular organization.
 *
 * All functions take DocumentContext and sheetId as first two params.
 *
 * @see sheet-api.ts - Main SheetAPI class that delegates to these functions
 */

import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';

import { KernelError, createWarning } from '../../../errors';
import type {
  CellData,
  CellFormat,
  CellRange,
  CellValue,
  CellValuePrimitive,
  DocumentContext,
} from './shared';
import { rawToCellValue } from './shared';

import { getFormat as getFormatInternal } from '../../../domain/cells/cell-properties';
import { getData, resolveProjectionAnchorFormula } from '../../../domain/cells/cell-reads';
import { getDisplayValue as getDisplayValueInternal } from '../../../domain/cells/cell-values';

import type { SetCellsResult } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import { parseA1, toA1 } from '@mog/spreadsheet-utils/a1';

import { isValidAddress } from '../../internal/utils';
import { invalidateWorksheetValidationCache } from '../validation-cache';
import { calendarPartsInTz } from './calendar-tz';
import { type CellInput, toCellInput } from './cell-input';
import { prepareExternalFormulaWrite } from '../../../services/external-formulas';
import { assertUnprotectedTableDefinition } from '../protected-table-operations';
import type { MutationAdmissionOptions } from '../../../bridges/compute';

// =============================================================================
// Cell Read Operations
// =============================================================================

/**
 * Get complete cell data including formula, format, etc.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellData or undefined if cell is empty
 */
export async function getCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellData | null> {
  const [data, fmt, formatted] = await Promise.all([
    getData(ctx, sheetId, row, col),
    getFormatInternal(ctx, sheetId, row, col),
    getDisplayValueInternal(ctx, sheetId, row, col),
  ]);
  if (!data) return null;

  // Map internal CellData (raw/computed) to contracts CellData (value)
  // For formula cells, use computed value; for others, use raw value
  // Raw value may be RichText - convert to plain string for API
  // Use formula presence as discriminator (not nullish coalescing) because
  // computed can legitimately be null (e.g., =IF(FALSE, 1, NULL))
  return {
    value: (data.formula !== undefined ? data.computed : rawToCellValue(data.raw)) ?? null,
    formula: data.formula,
    format: fmt ?? undefined,
    formatted: formatted ?? undefined,
  };
}

/**
 * Get the computed value of a cell.
 *
 * For formula cells, returns the calculated result.
 * For value cells, returns the raw value.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Cell value (string, number, boolean, or null)
 */
export async function getValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellValue> {
  const data = await getData(ctx, sheetId, row, col);
  if (!data) return null;
  // Raw value may be RichText - convert to plain string for API
  // Use formula presence as discriminator (not nullish coalescing) because
  // computed can legitimately be null (e.g., =IF(FALSE, 1, NULL))
  return (data.formula !== undefined ? data.computed : rawToCellValue(data.raw)) ?? null;
}

/**
 * Get the display string of a cell (formatted value).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Display string
 */
export async function getDisplayValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  return getDisplayValueInternal(ctx, sheetId, row, col);
}

/**
 * Get the formula of a cell, if any.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Formula string with "=" prefix or undefined
 */
export async function getFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<FormulaA1 | undefined> {
  // Use getData directly instead of getCell to avoid fetching format and display value
  const data = await getData(ctx, sheetId, row, col);
  if (!data?.formula) return undefined;
  // Rust is the source of truth for formula text — `compute_set_cell` persists
  // it for cross-sheet refs, `mutation_rename_sheet` rewrites it on rename, and
  // `mutation_named_range_update` rewrites it on named-range rename.
  return data.formula as FormulaA1;
}

/**
 * Get the format of a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellFormat or undefined
 */
export async function getFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellFormat | undefined> {
  return getFormatInternal(ctx, sheetId, row, col);
}

/**
 * Get the raw internal cell data including formula string, raw value, and computed value.
 *
 * Unlike `getCell` which normalizes the value, this returns all internal fields
 * so callers can distinguish between formula cells and value cells.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param includeFormula - Whether to include the formula string (default: true)
 * @returns Raw cell data or undefined if cell is empty
 */
export async function getRawCellData(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  includeFormula = true,
): Promise<
  | {
      raw: CellValue;
      formula?: FormulaA1;
      computed?: CellValue;
    }
  | undefined
> {
  const data = await ctx.computeBridge.getRawCellData(sheetId, row, col, includeFormula);
  if (data === null) return undefined;

  // Spill-member resolution: if no formula came back but the position is
  // inside a dynamic-array projection, surface the anchor's formula so the
  // formula bar reflects the spilling formula for every member of the spill
  // (Excel parity). The cell's own raw/computed values stay as the member's
  // materialized value.
  let formula = data.formula;
  if (includeFormula && formula === undefined) {
    const anchorFormula = await resolveProjectionAnchorFormula(ctx, sheetId, row, col);
    if (anchorFormula !== null) {
      formula = anchorFormula;
    }
  }

  return {
    raw: data.raw,
    ...(formula !== undefined ? { formula: asFormulaA1(formula) } : {}),
    ...(data.computed !== undefined ? { computed: data.computed } : {}),
  };
}

/**
 * Get the value a user would see in the formula bar for a cell.
 *
 * If the cell has a formula, returns the formula string with "=" prefix.
 * Otherwise returns the raw value as a string.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns The editing value (formula string or raw value), or empty string if cell is empty
 */
export async function getValueForEditing(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  // Rust owns formula-bar text via `compute_get_value_for_editing`.
  return ctx.computeBridge.getValueForEditing(sheetId, row, col);
}

/**
 * Get the CellId at a given position.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellId string or null if no cell exists at position
 */
export async function getCellIdAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  return ctx.computeBridge.getCellIdAt(sheetId, row, col);
}

// =============================================================================
// Cell Write Operations
// =============================================================================

async function reapplyActiveFiltersAfterWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<void> {
  const activeFilters = await ctx.computeBridge.getActiveFilters(sheetId);
  for (const filter of activeFilters) {
    await ctx.computeBridge.applyFilter(sheetId, filter.id);
  }
}

async function awaitAllSheetsBeforeCellWrite(ctx: DocumentContext): Promise<void> {
  await ctx.awaitMaterialized?.('allSheets');
}

interface TableHeaderWrite {
  tableName: string;
  columnIndex: number;
  currentName: string;
  newName: string;
}

interface TableHeaderCandidate {
  name: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  columns?: Array<{ name: string }>;
  hasHeaderRow: boolean;
}

interface ResolvedCellWrite {
  row: number;
  col: number;
  value: CellValuePrimitive | Date;
}

function tableHeaderText(value: CellValuePrimitive | Date): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function tableHeaderWriteFromTable(
  table: TableHeaderCandidate | null | undefined,
  row: number,
  col: number,
  value: CellValuePrimitive | Date,
): TableHeaderWrite | null {
  if (!table?.hasHeaderRow) return null;

  const { range } = table;
  if (row !== range.startRow || col < range.startCol || col > range.endCol) return null;

  const columnIndex = col - range.startCol;
  const column = table.columns?.[columnIndex];
  if (!column) return null;

  return {
    tableName: table.name,
    columnIndex,
    currentName: column.name,
    newName: tableHeaderText(value),
  };
}

async function resolveTableHeaderWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: CellValuePrimitive | Date,
): Promise<TableHeaderWrite | null> {
  const table = await ctx.computeBridge.getTableAtCell(sheetId, row, col);
  return tableHeaderWriteFromTable(table, row, col, value);
}

async function resolveTableHeaderWrites(
  ctx: DocumentContext,
  sheetId: SheetId,
  cells: ResolvedCellWrite[],
): Promise<Map<string, TableHeaderWrite>> {
  const writes = new Map<string, TableHeaderWrite>();
  if (cells.length === 0) return writes;

  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  if (tables.length === 0) return writes;

  for (const cell of cells) {
    const table = tables.find(
      (candidate) =>
        candidate.hasHeaderRow &&
        cell.row === candidate.range.startRow &&
        cell.col >= candidate.range.startCol &&
        cell.col <= candidate.range.endCol,
    );
    const write = tableHeaderWriteFromTable(table, cell.row, cell.col, cell.value);
    if (write) writes.set(`${cell.row},${cell.col}`, write);
  }

  return writes;
}

async function applyTableHeaderWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  write: TableHeaderWrite,
  alreadyMaterialized = false,
  options?: MutationAdmissionOptions,
): Promise<boolean> {
  if (write.currentName === write.newName) return false;
  if (!alreadyMaterialized) {
    await awaitAllSheetsBeforeCellWrite(ctx);
  }
  await assertUnprotectedTableDefinition(ctx, sheetId, 'tables.renameColumn', write.tableName);
  await ctx.computeBridge.renameTableColumn(
    write.tableName,
    write.columnIndex,
    write.newName,
    options,
  );
  return true;
}

/**
 * Set a cell's value.
 *
 * If the value starts with "=", it's treated as a formula.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param value - Value to set (string, number, boolean, or null)
 * @throws KernelError if the cell address is invalid
 *
 * @example
 * ```typescript
 * setCell(ctx, sheetId, 0, 0, "Hello");      // Text
 * setCell(ctx, sheetId, 0, 1, 42);           // Number
 * setCell(ctx, sheetId, 0, 2, true);         // Boolean
 * setCell(ctx, sheetId, 0, 3, "=A1+B1");     // Formula
 * setCell(ctx, sheetId, 0, 4, null);         // Clear cell
 * ```
 */
export async function setCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: CellValuePrimitive,
  options?: MutationAdmissionOptions,
): Promise<void> {
  if (!isValidAddress(row, col)) {
    throw KernelError.from(null, 'COMPUTE_ERROR', `Invalid cell address: row=${row}, col=${col}`);
  }

  const tableHeaderWrite = await resolveTableHeaderWrite(ctx, sheetId, row, col, value);
  if (tableHeaderWrite) {
    if (await applyTableHeaderWrite(ctx, sheetId, tableHeaderWrite, false, options)) {
      await reapplyActiveFiltersAfterWrite(ctx, sheetId);
    }
    return;
  }

  await awaitAllSheetsBeforeCellWrite(ctx);

  // Tell the change accumulator which cells are being directly written
  ctx.computeBridge.getMutationHandler()?.changeAccumulator.setDirectEdits([{ sheetId, row, col }]);
  const preparedValue = await prepareExternalFormulaWrite(ctx, sheetId, row, col, value);

  // Convert value to a typed CellInput for Rust — no in-band sentinels.
  const input = toCellInput(preparedValue as CellValuePrimitive);
  // Single-element batch — Rust handles CellId resolution, recalc, AND
  // locale-aware date format inference (e.g. "3/15/2024" → number value +
  // M/d/yyyy format applied atomically inside the mutation pipeline).
  await ctx.computeBridge.setCellsByPosition(sheetId, [{ row, col, input }], options);
  await reapplyActiveFiltersAfterWrite(ctx, sheetId);
}

/**
 * Clear a cell's value.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 */
export async function clearCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<void> {
  await setCell(ctx, sheetId, row, col, null);
}

// =============================================================================
// Cell Control Operations (checkbox, future: toggle, dropdown)
// =============================================================================

/**
 * Get the cell control for a cell, if any.
 *
 * Reads the cell value and checks if it has a control associated with it.
 * Currently returns a checkbox control based on the cell's boolean value
 * and the IS_CHECKBOX viewport flag.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellControl or undefined if the cell has no control
 */
export async function getControl(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<import('@mog-sdk/contracts/core').CellControl | undefined> {
  // Check if cell has IS_CHECKBOX flag via viewport data
  const cellData = await ctx.computeBridge.getCellData(sheetId, row, col);
  if (cellData == null) return undefined;

  const obj = cellData as Record<string, unknown>;
  // Check for control type marker in the cell data. Transports normalise
  // snake_case → camelCase at the boundary (see case-normalize.ts).
  if (obj.isCheckbox) {
    const value = await getValue(ctx, sheetId, row, col);
    return {
      type: 'checkbox' as const,
      checked: value === true,
    };
  }

  return undefined;
}

/**
 * Set or clear a cell control.
 *
 * When setting a checkbox control, writes the boolean value to the cell.
 * When clearing (control = undefined), clears the cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param control - The control to set, or undefined to clear
 */
export async function setControl(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  control: import('@mog-sdk/contracts/core').CellControl | undefined,
): Promise<void> {
  if (!isValidAddress(row, col)) {
    throw KernelError.from(null, 'COMPUTE_ERROR', `Invalid cell address: row=${row}, col=${col}`);
  }

  if (control === undefined) {
    // Clear the control by clearing the cell
    await clearCell(ctx, sheetId, row, col);
  } else {
    // Set the cell value based on the control's checked state
    // The Rust CellValue::Control variant will be used when the compute engine
    // detects this is a checkbox cell (via the IS_CHECKBOX flag on the viewport).
    await setCell(ctx, sheetId, row, col, control.checked);
  }
}

// =============================================================================
// Batch Cell Operations
// =============================================================================

/**
 * Bulk-write scattered cell values/formulas in a single IPC call.
 * Accepts both A1 addressing ({addr, value}) and numeric addressing ({row, col, value}).
 * Values starting with "=" are treated as formulas.
 */
export async function setCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  cells: Array<{
    addr?: string;
    address?: string;
    row?: number;
    col?: number;
    value: CellValuePrimitive | Date;
  }>,
  options?: MutationAdmissionOptions,
): Promise<SetCellsResult> {
  if (cells.length === 0) return { cellsWritten: 0, errors: null };

  // --- Resolve addresses in TS & normalise values ---
  const errors: Array<{ addr: string; error: string }> = [];
  const resolvedCells: ResolvedCellWrite[] = [];
  // Use a Map keyed by "row,col" for last-write-wins dedup
  const deduped = new Map<string, { row: number; col: number; input: CellInput }>();
  // Date values take a separate path (bridge.setDateValue) so they get a date
  // serial + date format, not String(Date).
  const dateWrites = new Map<string, { row: number; col: number; date: Date }>();

  for (const c of cells) {
    let row: number | undefined = c.row;
    let col: number | undefined = c.col;
    const addr = c.addr ?? c.address;

    if (addr !== undefined) {
      try {
        const parsed = parseA1(addr);
        row = parsed.row;
        col = parsed.col;
      } catch {
        errors.push({ addr, error: `Invalid cell address: ${addr}` });
        continue;
      }
    }

    if (row === undefined || col === undefined) {
      errors.push({ addr: addr ?? '(unknown)', error: 'Missing row/col coordinates' });
      continue;
    }

    if (!isValidAddress(row, col)) {
      const addrStr = addr ?? toA1(row, col);
      errors.push({ addr: addrStr, error: `Invalid cell address: row=${row}, col=${col}` });
      continue;
    }

    resolvedCells.push({ row, col, value: c.value });
  }

  const tableHeaderWrites = await resolveTableHeaderWrites(ctx, sheetId, resolvedCells);

  for (const { row, col, value } of resolvedCells) {
    const key = `${row},${col}`;
    const tableHeaderWrite = tableHeaderWrites.get(key);

    if (tableHeaderWrite) {
      deduped.delete(key);
      dateWrites.delete(key);
      tableHeaderWrites.set(key, tableHeaderWrite);
      continue;
    }

    if (value instanceof Date) {
      // Last-write-wins across both paths: a later date overwrites an earlier
      // string write at the same coord (and vice versa).
      await prepareExternalFormulaWrite(ctx, sheetId, row, col, value);
      deduped.delete(key);
      tableHeaderWrites.delete(key);
      dateWrites.set(key, { row, col, date: value });
      continue;
    }

    // Normalise value the same way setCell does.
    const preparedValue = await prepareExternalFormulaWrite(ctx, sheetId, row, col, value);
    const input = toCellInput(preparedValue as CellValuePrimitive);

    // Last-write-wins: later entries overwrite earlier ones for the same position
    dateWrites.delete(key);
    tableHeaderWrites.delete(key);
    deduped.set(key, { row, col, input });
  }

  const edits = Array.from(deduped.values());
  const dates = Array.from(dateWrites.values());
  const headerWrites = Array.from(tableHeaderWrites.values());
  const duplicatesRemoved =
    cells.length - errors.length - edits.length - dates.length - headerWrites.length;

  if (edits.length > 0 || dates.length > 0 || headerWrites.length > 0) {
    await awaitAllSheetsBeforeCellWrite(ctx);

    // --- Tell the change accumulator which cells are being directly written ---
    const allCoords = [
      ...edits.map((e) => ({ sheetId, row: e.row, col: e.col })),
      ...dates.map((d) => ({ sheetId, row: d.row, col: d.col })),
    ];
    if (allCoords.length > 0) {
      ctx.computeBridge.getMutationHandler()?.changeAccumulator.setDirectEdits(allCoords);
    }

    let wroteHeader = false;
    for (const headerWrite of headerWrites) {
      wroteHeader =
        (await applyTableHeaderWrite(ctx, sheetId, headerWrite, true, options)) || wroteHeader;
    }

    // --- Use the mutation pipeline path for primitives ---
    if (edits.length > 0) {
      if (options) {
        await ctx.computeBridge.setCellsByPosition(sheetId, edits, options);
      } else {
        await ctx.computeBridge.setCellsByPosition(sheetId, edits);
      }
    }
    // --- Date writes go through setDateValue so Rust produces a
    // date serial + applies a default date format when the cell is unformatted.
    // Calendar parts are resolved in the session's userTimezone (never host-local)
    // so the same Date instant produces the same calendar serial regardless of
    // whether the kernel is running in a browser, on a remote worker, or in a
    // headless test.
    for (const d of dates) {
      const parts = calendarPartsInTz(d.date, ctx.userTimezone);
      if (options) {
        await ctx.computeBridge.setDateValue(
          sheetId,
          d.row,
          d.col,
          parts.year,
          parts.month,
          parts.day,
          options,
        );
      } else {
        await ctx.computeBridge.setDateValue(
          sheetId,
          d.row,
          d.col,
          parts.year,
          parts.month,
          parts.day,
        );
      }
    }
    if (edits.length > 0 || dates.length > 0 || wroteHeader) {
      await reapplyActiveFiltersAfterWrite(ctx, sheetId);
    }
  }

  // --- Build result ---
  const result: SetCellsResult = {
    cellsWritten: edits.length + dates.length + headerWrites.length,
    errors: errors.length > 0 ? errors : null,
  };
  if (duplicatesRemoved > 0) {
    result.warnings = [
      createWarning(
        'API_DUPLICATE_COORDINATES',
        `${duplicatesRemoved} duplicate coordinate(s) resolved by last-write-wins`,
        {
          duplicatesRemoved,
        },
      ),
    ];
  }
  return result;
}

/**
 * Set a date value in a cell, automatically applying date format if needed.
 *
 * Rust handles: get existing format, compute serial number, write cell, apply format.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param date - Date components: year (e.g., 2024), month (1-12), day (1-31)
 */
export async function setDateValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  date: { year: number; month: number; day: number },
  options?: MutationAdmissionOptions,
): Promise<void> {
  await awaitAllSheetsBeforeCellWrite(ctx);
  await ctx.computeBridge.setDateValue(sheetId, row, col, date.year, date.month, date.day, options);
  await reapplyActiveFiltersAfterWrite(ctx, sheetId);
}

/**
 * Set a time value in a cell, automatically applying time format if needed.
 *
 * Rust handles: get existing format, compute serial number, write cell, apply format.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param time - Time components: hours (0-23), minutes (0-59), seconds (0-59)
 */
export async function setTimeValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  time: { hours: number; minutes: number; seconds: number },
  options?: MutationAdmissionOptions,
): Promise<void> {
  await awaitAllSheetsBeforeCellWrite(ctx);
  await ctx.computeBridge.setTimeValue(
    sheetId,
    row,
    col,
    time.hours,
    time.minutes,
    time.seconds,
    options,
  );
  await reapplyActiveFiltersAfterWrite(ctx, sheetId);
}

// =============================================================================
// Cell Relocation
// =============================================================================

/**
 * Relocate (move) a rectangular range of cells to a new position on the same
 * sheet.
 *
 * Routes through `computeBridge.relocateCellsYrs` (the yrs-routed mutation
 * handler `mutation_relocate_cells`) — same path the cross-sheet variant uses.
 * That handler emits Null `CellChange` patches for vacated source positions
 * and write patches for every target position, so the viewport buffer drops
 * the source values immediately after a same-sheet cut-paste. Cross-sheet
 * relocation already used this path; same-sheet relocation now does too so
 * there is one relocate path in Rust.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID (used for both source and target)
 * @param source - Source cell range to relocate
 * @param target - Target top-left position (row, col, 0-based)
 */
export async function relocateCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  source: CellRange,
  target: { row: number; col: number },
): Promise<void> {
  await awaitAllSheetsBeforeCellWrite(ctx);
  await ctx.computeBridge.relocateCellsYrs(
    sheetId,
    source.startRow,
    source.startCol,
    source.endRow,
    source.endCol,
    sheetId,
    target.row,
    target.col,
  );
  invalidateWorksheetValidationCache(ctx, sheetId);
}

/**
 * Get the projection range for a cell (spill/dynamic array).
 * Returns null if the cell is not a projection source.
 */
export async function getProjectionRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellRange | null> {
  try {
    return await ctx.computeBridge.getProjectionRange(sheetId, row, col);
  } catch {
    return null;
  }
}

/**
 * Get the projection source for a cell.
 * Returns null if the cell is not a projected position.
 */
export async function getProjectionSource(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ row: number; col: number } | null> {
  try {
    return await ctx.computeBridge.getProjectionSource(sheetId, row, col);
  } catch {
    return null;
  }
}

/**
 * Check if a cell is a projected position (receives a spilled value).
 */
export async function isProjectedPosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  try {
    return await ctx.computeBridge.isProjectedPosition(sheetId, row, col);
  } catch {
    return false;
  }
}

/**
 * Get all projection data overlapping a viewport range (batch query).
 * Returns one entry per projection with origin and dimensions.
 */
export async function getViewportProjectionData(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>> {
  try {
    return await ctx.computeBridge.getViewportProjectionData(
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    );
  } catch {
    return [];
  }
}

/**
 * Batch-resolve cell IDs to their row/col positions.
 *
 * Uses the Rust-side getCellPosition reverse lookup (cellId -> position)
 * for O(N) IPC calls instead of scanning the entire grid.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellIds - Array of cell ID strings to resolve
 * @returns Map of cellId -> { row, col }
 */
export async function batchGetCellPositions(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellIds: string[],
): Promise<Map<string, { row: number; col: number }>> {
  const result = new Map<string, { row: number; col: number }>();
  if (cellIds.length === 0) return result;

  // Single batch IPC call instead of N individual calls
  const positions = await ctx.computeBridge.resolveCellPositions(cellIds);

  for (let i = 0; i < cellIds.length; i++) {
    const pos = positions[i];
    if (pos) {
      result.set(cellIds[i], { row: pos.row, col: pos.col });
    }
  }

  return result;
}

/**
 * Split text in a column into multiple columns.
 * Rust handles the delimiter/textQualifier mapping internally via textToColumnsSimple.
 */
export async function textToColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  source: { startRow: number; endRow: number; col: number },
  dest: { row: number; col: number },
  options: {
    delimiter: 'comma' | 'tab' | 'semicolon' | 'space' | 'custom';
    customDelimiter?: string;
    treatConsecutiveAsOne?: boolean;
    textQualifier?: '"' | "'" | 'none';
  },
): Promise<void> {
  try {
    await ctx.computeBridge.textToColumnsSimple(
      sheetId,
      source.startRow,
      source.endRow,
      source.col,
      dest.row,
      dest.col,
      options.delimiter,
      options.customDelimiter ?? null,
      options.treatConsecutiveAsOne ?? false,
      options.textQualifier ?? '"',
    );
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to split text to columns: ${String(e)}`);
  }
}

/**
 * Remove duplicate rows in a range.
 */
export async function removeDuplicates(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: { columns: number[]; hasHeaders: boolean },
): Promise<{ removedCount: number }> {
  const raw = await ctx.computeBridge.removeDuplicates(
    sheetId,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
    options.columns,
    options.hasHeaders,
  );
  // Bridge returns MutationResult; extract duplicate-removal stats from the
  // raw payload. Transports normalise snake_case → camelCase at the boundary
  // (see infra/transport/src/case-normalize.ts), so we read camelCase only.
  const rawAny = (raw as unknown as Record<string, unknown>)?.data ?? raw;
  const data = rawAny as Record<string, unknown>;
  const removedCount = (data.duplicatesRemoved as number) ?? (data.removedCount as number) ?? 0;
  return { removedCount };
}
