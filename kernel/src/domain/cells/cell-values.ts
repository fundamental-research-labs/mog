/**
 * Cell Values Module
 *
 * Core cell value operations - get/set, parsing, batch operations, and value access.
 * This is the fundamental module for cell data manipulation.
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler handles event emission -- no manual event emission here.
 *
 * RESPONSIBILITIES:
 * - Single cell set (setValue, setValueAsText)
 * - Batch cell set (setValues)
 * - Cell data access (getData, getDataById, getValue, getDisplayValue, etc.)
 * - Cell properties access by CellId (getPropertiesById, setPropertiesById)
 * - Cell counting (getCount)
 *
 */

import { toCellId, type CellId, type IdentityFormula } from '@mog-sdk/contracts/cell-identity';
import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import type {
  CellAddress,
  CellProperties,
  CellRawValue,
  CellValue,
  SheetId,
} from '@mog-sdk/contracts/core';
import type { StoreCellData } from '@mog-sdk/contracts/store';
import { rawToCellValue } from '@mog/spreadsheet-utils/rich-text';

import type { DocumentContext } from '../../context/types';
import { computeValueToRaw, computeValueToCellValue } from './cell-iteration';
import { toCellInput } from '../../api/worksheet/operations/cell-input';
import type { CellInput } from '../../bridges/compute/compute-types.gen';
import { withDirectEditRange } from '../../bridges/compute';
import { createCellWriteVersionMutationOptions } from '../../api/internal/cell-write-version-options';

// =============================================================================
// Set Cell Value
// =============================================================================

/**
 * Set a single cell value.
 * Handles parsing and formula detection.
 *
 * Delegates to ComputeBridge.setCell(). Rust handles:
 * - Formula parsing, identity formula generation
 * - Calculator registration and evaluation
 * - Cell identity (CellId) management
 * - Provenance metadata
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param rawInput - Raw input value (string)
 * @param _context - Calculator context (handled by Rust)
 * @returns CellAddress of the changed cell (for dependent recalculation)
 */
export function setValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  rawInput: string,
  _context: unknown,
): CellAddress {
  const cellRef: CellAddress = { sheetId, row, col };

  if (rawInput === '' || rawInput === null || rawInput === undefined) {
    // Delete cell - get cell ID and clear it
    void (async () => {
      const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
      if (cellId) {
        void ctx.computeBridge.batchClearCells(
          [toCellId(cellId)],
          cellWriteOptions(ctx, 'grid.setCell', sheetId, row, col),
        );
      }
    })();
    return cellRef;
  }

  // Delegate to Rust - it handles formula parsing, identity formula, evaluation
  void (async () => {
    const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
    void ctx.computeBridge.setCell(
      sheetId,
      toCellId(cellId ?? ''),
      row,
      col,
      toCellInput(rawInput),
      cellWriteOptions(ctx, 'grid.setCell', sheetId, row, col),
    );
  })();

  return cellRef;
}

/**
 * Set a cell value as text WITHOUT coercion.
 *
 * This function stores the value as literal text, bypassing
 * type coercion. Used when forcedTextMode is enabled via
 * leading apostrophe.
 *
 * Unlike setValue(), this function:
 * - Does NOT convert "123" to number 123
 * - Does NOT convert "00123" to 123 (preserves leading zeros)
 * - Does NOT interpret "=SUM(...)" as a formula - stores as literal text
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param value - String value to store as-is (no coercion)
 * @returns CellAddress reference
 */
export function setValueAsText(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: string,
): CellAddress {
  const cellRef: CellAddress = { sheetId, row, col };

  if (value === '' || value === null || value === undefined) {
    void ctx.computeBridge.clearRangeByPosition(
      sheetId,
      row,
      col,
      row,
      col,
      cellWriteOptions(ctx, 'grid.setValueAsText', sheetId, row, col),
    );
    return cellRef;
  }

  // Store as literal text — Rust generates CellId internally
  void ctx.computeBridge.setCellValueAsText(
    sheetId,
    row,
    col,
    value,
    cellWriteOptions(ctx, 'grid.setValueAsText', sheetId, row, col),
  );

  return cellRef;
}

// =============================================================================
// Set Multiple Cell Values (Batch)
// =============================================================================

/**
 * Set multiple cell values at once (for paste operations, imports, etc.).
 *
 * Delegates to ComputeBridge.setCellsByPosition() — a single batch IPC call.
 * Rust handles CellId resolution, formula parsing, cell clearing (for empty
 * inputs), identity formula generation, and evaluation internally.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Target sheet
 * @param updates - Array of cell updates
 * @param _context - Calculator context (handled by Rust)
 * @param _origin - Transaction origin (handled by Rust)
 * @returns Array of changed CellAddresses (for dependent recalculation)
 */
export function setValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  updates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
  _context: unknown,
  _origin: 'user' | 'import' | 'api' = 'user',
): CellAddress[] {
  const changedRefs: CellAddress[] = [];

  if (updates.length === 0) return changedRefs;

  // Build position-based edits for a single batch IPC call.
  // setCellsByPosition handles CellId resolution internally in Rust,
  // eliminating per-cell getCellIdAt IPC overhead.
  // Empty string input clears the cell in Rust.
  void (async () => {
    const edits: Array<{ row: number; col: number; input: CellInput }> = updates.map(
      ({ row, col, value }) => ({
        row,
        col,
        input: toCellInput(value as string | number | boolean | null | undefined),
      }),
    );

    await ctx.computeBridge.setCellsByPosition(
      sheetId,
      edits,
      createCellWriteVersionMutationOptions(ctx, {
        operationIdPrefix: `grid.setValues.${_origin}`,
        sheetIds: [sheetId],
      }),
    );
  })();

  // Build return refs
  for (const { row, col } of updates) {
    changedRefs.push({ sheetId, row, col });
  }

  return changedRefs;
}

// =============================================================================
// Set Formula Direct (for Fill Operations)
// =============================================================================

/**
 * Set a cell's formula directly from an IdentityFormula.
 * Used by fill operations where IdentityFormula is already computed.
 *
 * Delegates to ComputeBridge.setCell(). Rust handles formula
 * registration and evaluation.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param _identityFormula - The pre-computed IdentityFormula (used by Rust internally)
 * @param displayFormula - The A1 display string
 * @returns Cell reference for recalculation tracking
 */
export function setFormulaDirect(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  _identityFormula: IdentityFormula,
  displayFormula: string,
): { sheetId: SheetId; row: number; col: number } {
  const cellRef = { sheetId, row, col };

  // Use setCell with the formula string - Rust will parse and register
  const formulaInput = displayFormula.startsWith('=') ? displayFormula : `=${displayFormula}`;

  void (async () => {
    const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
    void ctx.computeBridge.setCell(
      sheetId,
      toCellId(cellId ?? ''),
      row,
      col,
      toCellInput(formulaInput),
      cellWriteOptions(ctx, 'grid.setFormulaDirect', sheetId, row, col),
    );
  })();

  return cellRef;
}

// =============================================================================
// Get Cell Data
// =============================================================================

/**
 * Get cell data by position.
 *
 * Queries ComputeBridge for cell data at the given position.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Cell data or undefined if empty
 */
export async function getData(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<StoreCellData | undefined> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (!cellId) return undefined;
  const brandedCellId = toCellId(cellId);

  const activeCellData = await ctx.computeBridge.getActiveCell(sheetId, brandedCellId);
  if (!activeCellData) return undefined;

  return {
    id: toCellId(activeCellData.cellId),
    row,
    col,
    raw: computeValueToRaw(activeCellData.value),
    computed: computeValueToCellValue(activeCellData.value),
    formula: activeCellData.formula ? asFormulaA1(activeCellData.formula) : undefined,
    hyperlink: activeCellData.hyperlinkUrl,
  };
}

/**
 * Get cell data by CellId directly (for cases where you already have the ID).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - Cell ID
 * @returns Cell data or undefined if not found
 */
export async function getDataById(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
): Promise<StoreCellData | undefined> {
  const activeCellData = await ctx.computeBridge.getActiveCell(sheetId, cellId);
  if (!activeCellData) return undefined;

  // Get position from the cell
  const position = await ctx.computeBridge.getCellPosition(sheetId, cellId);
  const row = position?.row ?? 0;
  const col = position?.col ?? 0;

  return {
    id: toCellId(activeCellData.cellId),
    row,
    col,
    raw: computeValueToRaw(activeCellData.value),
    computed: computeValueToCellValue(activeCellData.value),
    formula: activeCellData.formula ? asFormulaA1(activeCellData.formula) : undefined,
    hyperlink: activeCellData.hyperlinkUrl,
  };
}

/**
 * Get display value for a cell (formatted by Rust compute-core).
 *
 * Delegates entirely to the compute bridge which handles format codes,
 * locale, theme refs, date serials, etc.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Display string
 */
export async function getDisplayValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  const value = await ctx.computeBridge.getDisplayValue(sheetId, row, col);
  return String(value);
}

/**
 * Get raw value for formula bar display.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Raw value string
 */
export async function getRawValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  const data = await getData(ctx, sheetId, row, col);
  if (!data) return '';
  if (data.raw === null) return '';
  return String(data.raw);
}

/**
 * Get value for editing (with apostrophe prefix if forcedTextMode).
 *
 * For formula cells, dynamically computes the A1 references.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param editText - Pre-computed by Rust for date/time cells (ViewportCell.editText)
 * @returns Value string with apostrophe prefix if forcedTextMode is true
 */
export async function getValueForEditing(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  editText?: string,
): Promise<string> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (!cellId) return '';
  const brandedCellId = toCellId(cellId);

  const activeCellData = await ctx.computeBridge.getActiveCell(sheetId, brandedCellId);
  if (!activeCellData) return '';

  // Formula already includes "=" prefix from Rust
  if (activeCellData.formula) {
    return activeCellData.formula;
  }

  // Use edit_text from Rust (for date/time formatted cells)
  if (editText) {
    return editText;
  }
  if (activeCellData.editText) {
    return activeCellData.editText;
  }

  // Non-formula cells: use raw value
  const value = activeCellData.value;
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);

  return '';
}

/**
 * Get the effective value of a cell, correctly handling formulas vs values.
 *
 * INVARIANT: For formula cells, ALWAYS use computed (even if null).
 * For value cells, use rawToCellValue(data.raw).
 *
 * @param data - The cell data
 * @returns The effective cell value
 */
export function getEffectiveValue(data: StoreCellData): CellValue | null {
  if (data.formula !== undefined) {
    return data.computed ?? null;
  }
  return rawToCellValue(data.raw) ?? null;
}

function cellWriteOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow = startRow,
  endCol = startCol,
) {
  return withDirectEditRange(
    createCellWriteVersionMutationOptions(ctx, {
      operationIdPrefix,
      sheetIds: [sheetId],
    }),
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
  );
}

/**
 * Get the effective cell value (computed if formula, raw otherwise).
 *
 * Excel compatibility: Formula cells that evaluate to null return 0.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Cell value or undefined if empty cell
 */
export async function getValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellValue | undefined> {
  const data = await getData(ctx, sheetId, row, col);
  if (!data) return undefined;

  const value = getEffectiveValue(data);

  if (value === null && data.formula !== undefined) {
    return 0;
  }

  return value ?? undefined;
}

// =============================================================================
// Cell Count
// =============================================================================

/**
 * Get the count of non-empty cells in a sheet.
 *
 * Queries ComputeBridge for data bounds and estimates cell count.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Number of non-empty cells
 */
export async function getCount(ctx: DocumentContext, sheetId: SheetId): Promise<number> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return 0;

  // Query all cells in the data bounds to count them
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  return rangeData?.cells?.length ?? 0;
}

// =============================================================================
// Cell Properties Access (by CellId)
// =============================================================================

/**
 * Get cell properties by CellId.
 *
 * Queries ComputeBridge for cell format/properties.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - Cell ID
 * @returns CellProperties or undefined
 */
export async function getPropertiesById(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
): Promise<CellProperties | undefined> {
  const position = await ctx.computeBridge.getCellPosition(sheetId, cellId);
  if (!position) return undefined;

  const { row, col } = position;
  const format = await ctx.computeBridge.getCellFormat(sheetId, cellId, row, col);

  if (!format) return undefined;

  return { format } as CellProperties;
}

/**
 * Set cell properties by CellId.
 *
 * Delegates to ComputeBridge.setCellFormat().
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - Cell ID
 * @param props - Cell properties to set
 */
export function setPropertiesById(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
  props: CellProperties,
): void {
  if (props.format) {
    void ctx.computeBridge.setCellFormat(sheetId, cellId, props.format);
  }
}
