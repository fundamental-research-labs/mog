/**
 * Kernel API: Cells
 *
 * @stability experimental
 *
 * Low-level function-oriented API for cell read/write operations.
 * Available for feedback — may change across minor versions.
 *
 * External SDK consumers: prefer the high-level Workbook/Worksheet API
 * (createWorkbook → ws.setCell / ws.getValue). Use this namespace only
 * when you need direct positional cell access with an IKernelContext.
 *
 * Composes:
 * - Reads: from kernel domain/cells/cell-reads
 * - Writes: direct ComputeBridge calls
 *
 * All functions accept IKernelContext for a consistent public API surface.
 * Internal casts to DocumentContext are safe — callers always pass DocumentHandle.context.
 */

import * as CellReads from '../../domain/cells/cell-reads';
import { toCellId, type IdentityFormula } from '@mog-sdk/contracts/cell-identity';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { CellWriteData, StoreCellData } from '@mog-sdk/contracts/store';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import { toCellInput } from '../worksheet/operations/cell-input';

// Re-export CellWriteData so namespace consumers can import it alongside Cells.*
export type { CellWriteData } from '@mog-sdk/contracts/store';

// =============================================================================
// Types
// =============================================================================

/**
 * @deprecated Use IKernelContext from @mog-sdk/contracts/kernel instead.
 * All namespace API functions now accept IKernelContext directly.
 */
export interface CellMutationContext {
  readonly eventBus: IEventBus;
  readonly computeBridge: ComputeBridge;
}

/**
 * @deprecated Renamed to `CellWriteData` (from @mog-sdk/contracts/store).
 * This alias will be removed in a future release.
 */
export type KernelCellData = CellWriteData;

// =============================================================================
// Reads
// =============================================================================

/** Get cell data at position. */
export async function getData(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<StoreCellData | undefined> {
  return CellReads.getData(ctx as DocumentContext, sheetId, row, col);
}

/** Get raw value at position. */
export async function getRawValue(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  return CellReads.getRawValue(ctx as DocumentContext, sheetId, row, col);
}

/** Get cell value (computed or raw). */
export async function getValue(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellValue | undefined> {
  return CellReads.getValue(ctx as DocumentContext, sheetId, row, col);
}

/**
 * Get effective value from pre-fetched cell data (sync utility).
 *
 * Prefer getEffectiveValueAt() for the standard async (ctx, sheetId, row, col) pattern.
 */
export function getEffectiveValueFromData(data: StoreCellData): CellValue | null {
  return CellReads.getEffectiveValue(data);
}

/**
 * Get effective value at position (standard async pattern).
 * For formula cells, returns computed value. For value cells, returns raw value.
 * Returns undefined if the cell does not exist (consistent with getValue).
 */
export async function getEffectiveValueAt(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellValue | undefined> {
  const data = await CellReads.getData(ctx as DocumentContext, sheetId, row, col);
  if (!data) return undefined;
  return CellReads.getEffectiveValue(data) ?? undefined;
}

/**
 * @deprecated Use getEffectiveValueFromData() or getEffectiveValueAt() instead.
 */
export const getEffectiveValue = CellReads.getEffectiveValue;

/** Get CellId at position. */
export async function getCellIdAt(ctx: IKernelContext, sheetId: SheetId, row: number, col: number) {
  return CellReads.getCellIdAt(ctx as DocumentContext, sheetId, row, col);
}

// =============================================================================
// Writes
// =============================================================================

/**
 * Set cell data. Calls ComputeBridge directly — Rust is the sole source of truth.
 */
export async function set(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
  data: CellWriteData,
): Promise<void> {
  const { computeBridge } = ctx as DocumentContext;
  const input = data.formula ? (data.formula as string) : String(data.raw ?? '');
  await computeBridge.setCellValueParsed(sheetId, row, col, input);
}

/**
 * Set a cell to a simple value or formula.
 * Formulas are detected by "=" prefix. Everything else is treated as a raw value.
 */
export async function setValue(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: CellRawValue | FormulaA1,
): Promise<void> {
  const { computeBridge } = ctx as DocumentContext;
  await computeBridge.setCellValueParsed(sheetId, row, col, String(value ?? ''));
}

/**
 * Set multiple cells in a single IPC call.
 */
export async function setBatch(
  ctx: IKernelContext,
  sheetId: SheetId,
  edits: Array<{ row: number; col: number; value: CellRawValue | FormulaA1 }>,
): Promise<void> {
  const { computeBridge } = ctx as DocumentContext;
  const mapped = edits.map((e) => ({
    row: e.row,
    col: e.col,
    input: toCellInput(e.value as string | number | boolean | null | undefined),
  }));
  await computeBridge.setCellsByPosition(sheetId, mapped);
}

/**
 * Remove (clear) a cell.
 */
export async function remove(
  ctx: IKernelContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<void> {
  const { computeBridge } = ctx as DocumentContext;
  const cellId = await computeBridge.getCellIdAt(sheetId, row, col);
  if (cellId) {
    await computeBridge.batchClearCells([toCellId(cellId)]);
  }
}

/** @deprecated Use remove() instead. */
export const del = remove;
