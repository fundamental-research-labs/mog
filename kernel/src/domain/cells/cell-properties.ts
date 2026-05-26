/**
 * Properties Domain Module
 *
 * Unified cell properties operations (format + metadata + styles).
 * Pure functions that take DocumentContext as first parameter.
 *
 * All operations delegate to ComputeBridge (Rust compute core).
 * Write operations are fire-and-forget via ctx.computeBridge.
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 */

import type {
  CellFormat,
  CellMetadata,
  CellProperties,
  CellRange,
  CellStyle,
  SheetId,
  StyleCategory,
} from '@mog-sdk/contracts/core';
import { BUILT_IN_STYLES, getBuiltInStyleById, isBuiltInStyle } from './built-in-styles';

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert a CellRange to the tuple format expected by ComputeBridge range methods.
 * Format: [startRow, startCol, endRow, endCol]
 */
function rangeToTuple(range: CellRange): [number, number, number, number] {
  return [range.startRow, range.startCol, range.endRow, range.endCol];
}

/**
 * Convert a single cell position to a range tuple (single-cell range).
 */
function cellToRangeTuple(row: number, col: number): [number, number, number, number] {
  return [row, col, row, col];
}

// =============================================================================
// Core Operations - Get/Set/Clear Full Properties
// =============================================================================

/**
 * Get all properties for a cell.
 * Queries ComputeBridge for cell data including format and metadata.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of cell properties or undefined
 */
export async function getProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellProperties | undefined> {
  // Use getActiveCell which returns ActiveCellData with metadata (unlike queryRange/RangeCellData)
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (!cellId) return undefined;

  const activeCell = await ctx.computeBridge.getActiveCell(sheetId, cellId);
  if (!activeCell) return undefined;

  const props: CellProperties = {};

  if (activeCell.format) {
    props.format = activeCell.format;
  }
  if (activeCell.metadata) {
    const meta = activeCell.metadata as CellMetadata;
    if (meta.modifiedBy !== undefined) props.modifiedBy = meta.modifiedBy;
    if (meta.modifiedAt !== undefined) props.modifiedAt = meta.modifiedAt;
    if (meta.dataSource !== undefined) props.dataSource = meta.dataSource;
    if (meta.validationErrors !== undefined) props.validationErrors = meta.validationErrors;
    if (meta.connectionId !== undefined) props.connectionId = meta.connectionId;
  }

  if (Object.keys(props).length === 0) return undefined;
  return props;
}

/**
 * Set or update properties for a cell.
 * Delegates format to ComputeBridge. Metadata set via CB.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param partial - Partial properties to merge
 * @param _origin - Transaction origin (handled by Rust)
 */
export function setProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  partial: Partial<CellProperties>,
  _origin: string = 'user',
): void {
  if (partial.format) {
    void ctx.computeBridge.setFormatForRanges(
      sheetId,
      [cellToRangeTuple(row, col)],
      partial.format,
    );
  }
  // Metadata fields (modifiedBy, modifiedAt, dataSource, validationErrors, connectionId)
  // are managed by Rust internally during cell operations.
  // For explicit metadata writes, delegate via setFormatForRanges with metadata flag.
  const { format: _, ...metadataFields } = partial;
  if (Object.keys(metadataFields).length > 0) {
    // Metadata is stored by Rust as part of cell properties.
    // setFormatForRanges handles format; metadata is set alongside it.
    // For now, metadata fields are passed to Rust via the format channel.
    void ctx.computeBridge.setFormatForRanges(
      sheetId,
      [cellToRangeTuple(row, col)],
      metadataFields,
    );
  }
}

/**
 * Remove all properties for a cell.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param _origin - Transaction origin (handled by Rust)
 */
export function clearProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.clearFormatForRanges(sheetId, [cellToRangeTuple(row, col)]);
}

// =============================================================================
// Format Operations
// =============================================================================

/**
 * Get format for a cell.
 * Delegates to ComputeBridge.getCellFormat which returns the effective format
 * (merged: default -> col -> row -> cell).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of cell format or undefined
 */
export async function getFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellFormat | undefined> {
  const result = await ctx.computeBridge.queryRange(sheetId, row, col, row, col);
  if (!result?.cells || result.cells.length === 0) return undefined;
  return result.cells[0]?.format ?? undefined;
}

/**
 * Set format for a single cell.
 * Delegates to ComputeBridge.setFormatForRanges.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param format - Partial format to merge
 */
export function setFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  format: Partial<CellFormat>,
): void {
  void ctx.computeBridge.setFormatForRanges(sheetId, [cellToRangeTuple(row, col)], format);
}

/**
 * Clear format for a single cell.
 * Delegates to ComputeBridge.clearFormatForRanges.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 */
export function clearFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): void {
  void ctx.computeBridge.clearFormatForRanges(sheetId, [cellToRangeTuple(row, col)]);
}

// =============================================================================
// Batch Format Operations
// =============================================================================

/**
 * Set format for multiple cells in a single operation.
 * Groups cells into ranges for efficient ComputeBridge call.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cells - Array of cell coordinates
 * @param format - Partial format to apply to all cells
 */
export function setFormats(
  ctx: DocumentContext,
  sheetId: SheetId,
  cells: Array<{ row: number; col: number }>,
  format: Partial<CellFormat>,
): void {
  if (cells.length === 0) return;

  const ranges: Array<[number, number, number, number]> = cells.map(({ row, col }) =>
    cellToRangeTuple(row, col),
  );
  void ctx.computeBridge.setFormatForRanges(sheetId, ranges, format);
}

/**
 * Clear format for multiple cells in a single operation.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cells - Array of cell coordinates
 */
export function clearFormats(
  ctx: DocumentContext,
  sheetId: SheetId,
  cells: Array<{ row: number; col: number }>,
): void {
  if (cells.length === 0) return;

  const ranges: Array<[number, number, number, number]> = cells.map(({ row, col }) =>
    cellToRangeTuple(row, col),
  );
  void ctx.computeBridge.clearFormatForRanges(sheetId, ranges);
}

// =============================================================================
// Metadata Operations
// =============================================================================

/**
 * Get metadata for a cell (all properties except format).
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of cell metadata or undefined
 */
export async function getMetadata(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellMetadata | undefined> {
  const props = await getProperties(ctx, sheetId, row, col);
  if (!props) return undefined;

  const { format: _, ...metadata } = props;
  if (Object.keys(metadata).length === 0) return undefined;
  const cellMetadata: Omit<CellProperties, 'format'> = metadata;
  return cellMetadata;
}

/**
 * Set or update metadata for a cell.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param partial - Partial metadata to merge
 * @param _origin - Transaction origin (handled by Rust)
 */
export function setMetadata(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  partial: Partial<CellMetadata>,
  _origin: string = 'user',
): void {
  // Metadata is stored by Rust as part of cell properties.
  // Delegate via setFormatForRanges which handles the full property bag.
  void ctx.computeBridge.setFormatForRanges(sheetId, [cellToRangeTuple(row, col)], partial);
}

/**
 * Remove all metadata for a cell.
 * Preserves format.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param _origin - Transaction origin (handled by Rust)
 */
export function clearMetadata(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  _origin: string = 'user',
): void {
  // Clear metadata by setting empty metadata fields.
  // Rust handles preserving format when clearing metadata.
  // validationErrors is a metadata field passed through the format channel to Rust.
  void ctx.computeBridge.setFormatForRanges(sheetId, [cellToRangeTuple(row, col)], {
    validationErrors: [],
  } as unknown as CellFormat);
}

// =============================================================================
// Query Operations
// =============================================================================

/**
 * Find all cells matching a properties predicate.
 * Delegates to ComputeBridge.queryRange for the full sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param predicate - Function that returns true for matching properties
 * @returns Promise of cell coordinates where predicate returns true
 */
export async function queryByProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  predicate: (props: CellProperties) => boolean,
  rangeBounds?: { startRow: number; startCol: number; endRow: number; endCol: number },
): Promise<Array<{ row: number; col: number }>> {
  let minRow: number, minCol: number, maxRow: number, maxCol: number;
  if (rangeBounds) {
    minRow = rangeBounds.startRow;
    minCol = rangeBounds.startCol;
    maxRow = rangeBounds.endRow;
    maxCol = rangeBounds.endCol;
  } else {
    const bounds = await ctx.computeBridge.getDataBounds(sheetId);
    if (!bounds) return [];
    minRow = bounds.minRow;
    minCol = bounds.minCol;
    maxRow = bounds.maxRow;
    maxCol = bounds.maxCol;
  }

  const rangeData = await ctx.computeBridge.queryRange(sheetId, minRow, minCol, maxRow, maxCol);
  const cells = rangeData?.cells;
  if (!cells || cells.length === 0) return [];

  const results: Array<{ row: number; col: number }> = [];
  for (const cell of cells) {
    // RangeCellData has format but not metadata — use getActiveCell for metadata.
    //
    // `cell.cellId` can be the empty string for format-only cells where the
    // engine has no `CellMirror` entry (visit.cell_id == None && !is_projection
    // in compute/core/src/storage/engine/queries.rs:1588 emits `String::new()`
    // by serde contract). Forwarding an empty string into `getActiveCell`
    // surfaces as a Rust UUID parse error (`invalid length: expected length 32
    // for simple format, found 0`) on the WASM/NAPI boundary, which the
    // app-eval `recentErrors` ring captures as a `runtime_error` and mis-routes
    // the failure classifier (the FIX-004 cluster on the 2026-04-27 run).
    //
    // Skip the metadata fetch when the cell has no identity — there is no
    // CellMirror metadata to retrieve. Format alone still flows through `props`.
    let activeCell: Awaited<ReturnType<typeof ctx.computeBridge.getActiveCell>> | null = null;
    if (cell.cellId) {
      activeCell = await ctx.computeBridge.getActiveCell(sheetId, cell.cellId);
    }
    const props: CellProperties = {};
    if (cell.format) props.format = cell.format;
    if (activeCell?.metadata) {
      const meta = activeCell.metadata as CellMetadata;
      if (meta.modifiedBy !== undefined) props.modifiedBy = meta.modifiedBy;
      if (meta.modifiedAt !== undefined) props.modifiedAt = meta.modifiedAt;
      if (meta.dataSource !== undefined) props.dataSource = meta.dataSource;
      if (meta.validationErrors !== undefined) props.validationErrors = meta.validationErrors;
      if (meta.connectionId !== undefined) props.connectionId = meta.connectionId;
    }
    if (Object.keys(props).length > 0 && predicate(props)) {
      results.push({ row: cell.row, col: cell.col });
    }
  }
  return results;
}

/**
 * Find all cells matching a metadata predicate.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param predicate - Function that returns true for matching metadata
 * @returns Promise of cell coordinates where predicate returns true
 */
export async function queryByMetadata(
  ctx: DocumentContext,
  sheetId: SheetId,
  predicate: (meta: CellMetadata) => boolean,
  rangeBounds?: { startRow: number; startCol: number; endRow: number; endCol: number },
): Promise<Array<{ row: number; col: number }>> {
  return queryByProperties(
    ctx,
    sheetId,
    (props) => {
      const { format: _, ...metadata } = props;
      if (Object.keys(metadata).length === 0) return false;
      return predicate(metadata as CellMetadata);
    },
    rangeBounds,
  );
}

// =============================================================================
// Style Retrieval
// =============================================================================

/**
 * Get a style by ID.
 * Built-in styles are resolved from the static constant table.
 * Custom styles are managed by Rust.
 *
 * @param ctx - Store context
 * @param styleId - Style ID to find
 * @returns The style if found, undefined otherwise
 */
export async function getStyleById(
  ctx: DocumentContext,
  styleId: string,
): Promise<CellStyle | undefined> {
  // Built-in styles are pure constants (no Rust query needed)
  const builtIn = getBuiltInStyleById(styleId);
  if (builtIn) return builtIn;

  // Custom cell styles are stored in Rust.
  const customStyles = await ctx.computeBridge.getAllCustomCellStyles();
  const match = customStyles.find((s) => s.id === styleId || s.name === styleId);
  if (match) {
    return {
      id: match.id,
      name: match.name,
      category: (match.category as StyleCategory) ?? 'custom',
      format: match.format,
      builtIn: match.builtIn,
    };
  }
  return undefined;
}

/**
 * Get all available styles (built-in + custom).
 *
 * @param ctx - Store context
 * @returns Promise of all styles (built-in first, then custom)
 */
export async function getAllStyles(ctx: DocumentContext): Promise<CellStyle[]> {
  const customDefs = await ctx.computeBridge.getAllCustomCellStyles();
  const customStyles: CellStyle[] = customDefs.map((d) => ({
    id: d.id,
    name: d.name,
    category: (d.category as StyleCategory) ?? 'custom',
    format: d.format,
    builtIn: d.builtIn,
  }));
  return [...BUILT_IN_STYLES, ...customStyles];
}

/**
 * Get all custom styles (excludes built-in).
 *
 * @param ctx - Store context
 * @returns Promise of custom styles
 */
export async function getCustomStyles(ctx: DocumentContext): Promise<CellStyle[]> {
  const customDefs = await ctx.computeBridge.getAllCustomCellStyles();
  return customDefs
    .filter((d) => !d.builtIn)
    .map((d) => ({
      id: d.id,
      name: d.name,
      category: (d.category as StyleCategory) ?? 'custom',
      format: d.format,
      builtIn: d.builtIn,
    }));
}

/**
 * Get styles filtered by category.
 * Includes both built-in and custom styles in the category.
 *
 * @param ctx - Store context
 * @param category - Style category to filter by
 * @returns Promise of styles in the category
 */
export async function getStylesByCategory(
  ctx: DocumentContext,
  category: StyleCategory,
): Promise<CellStyle[]> {
  const all = await getAllStyles(ctx);
  return all.filter((s) => s.category === category);
}

// =============================================================================
// Style Application
// =============================================================================

/**
 * Apply a style to a cell range.
 *
 * IMPORTANT: This COPIES the format values to cells, NOT a style reference.
 * Per CellProperties contract, cells store CellFormat, not style IDs.
 *
 * @param ctx - Store context
 * @param sheetId - Target sheet
 * @param range - Cell range to apply style to
 * @param styleId - Style ID to apply
 * @returns Promise of true if style was applied, false if style not found
 */
export async function applyStyleToRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  styleId: string,
): Promise<boolean> {
  const style = await getStyleById(ctx, styleId);
  if (!style) return false;

  void ctx.computeBridge.setFormatForRanges(sheetId, [rangeToTuple(range)], style.format);
  return true;
}

/**
 * Apply a style to a single cell.
 *
 * @param ctx - Store context
 * @param sheetId - Target sheet
 * @param row - Row index
 * @param col - Column index
 * @param styleId - Style ID to apply
 * @returns Promise of true if style was applied, false if style not found
 */
export async function applyStyleToCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  styleId: string,
): Promise<boolean> {
  const style = await getStyleById(ctx, styleId);
  if (!style) return false;

  void ctx.computeBridge.setFormatForRanges(sheetId, [cellToRangeTuple(row, col)], style.format);
  return true;
}

// =============================================================================
// Custom Style CRUD
// =============================================================================

/**
 * Create a new custom style.
 * Delegates to Rust for storage.
 *
 * @param ctx - Store context
 * @param style - Style to create (builtIn will be set to false)
 * @returns The created style
 * @throws Error if style ID is a built-in
 */
export async function createCustomStyle(
  ctx: DocumentContext,
  style: Omit<CellStyle, 'builtIn'>,
): Promise<CellStyle> {
  if (isBuiltInStyle(style.id)) {
    throw new KernelError(
      'DOMAIN_CELL_STYLE_INVALID',
      `Cannot create custom style with built-in ID: ${style.id}`,
    );
  }

  const fullStyle: CellStyle = { ...style, builtIn: false };
  await ctx.computeBridge.createCustomCellStyle({
    id: fullStyle.id,
    name: fullStyle.name,
    category: fullStyle.category,
    format: fullStyle.format,
    builtIn: false,
  });
  return fullStyle;
}

/**
 * Update an existing custom style.
 * Delegates to Rust for storage.
 *
 * @param ctx - Store context
 * @param styleId - ID of style to update
 * @param updates - Partial style updates
 * @returns The updated style, or undefined if not found or built-in
 */
export async function updateCustomStyle(
  ctx: DocumentContext,
  styleId: string,
  updates: Partial<Omit<CellStyle, 'id' | 'builtIn'>>,
): Promise<CellStyle | undefined> {
  if (isBuiltInStyle(styleId)) {
    return undefined;
  }

  // Fetch existing custom styles and find the one to update
  const customDefs = await ctx.computeBridge.getAllCustomCellStyles();
  const existing = customDefs.find((s) => s.id === styleId);
  if (!existing || existing.builtIn) return undefined;

  const updated = {
    id: existing.id,
    name: updates.name ?? existing.name,
    category: updates.category ?? existing.category,
    format: updates.format ? { ...existing.format, ...updates.format } : existing.format,
    builtIn: false,
  };
  await ctx.computeBridge.updateCustomCellStyle(styleId, updated);
  return {
    id: updated.id,
    name: updated.name,
    category: (updated.category as StyleCategory) ?? 'custom',
    format: updated.format,
    builtIn: false,
  };
}

/**
 * Delete a custom style.
 * Delegates to Rust for storage.
 *
 * @param ctx - Store context
 * @param styleId - ID of style to delete
 * @returns false for built-in, true if deleted
 */
export async function deleteCustomStyle(ctx: DocumentContext, styleId: string): Promise<boolean> {
  if (isBuiltInStyle(styleId)) {
    return false;
  }

  await ctx.computeBridge.deleteCustomCellStyle(styleId);
  return true;
}

/**
 * Duplicate an existing style as a new custom style.
 *
 * @param ctx - Store context
 * @param sourceStyleId - Style to duplicate
 * @param newId - ID for the new style
 * @param newName - Name for the new style
 * @returns Promise of the new style, or undefined if source not found
 */
export async function duplicateStyle(
  ctx: DocumentContext,
  sourceStyleId: string,
  newId: string,
  newName: string,
): Promise<CellStyle | undefined> {
  const source = await getStyleById(ctx, sourceStyleId);
  if (!source) return undefined;

  return await createCustomStyle(ctx, {
    id: newId,
    name: newName,
    category: 'custom',
    format: { ...source.format },
  });
}

// =============================================================================
// Style Queries
// =============================================================================

/**
 * Check if a style exists (built-in or custom).
 *
 * @param ctx - Store context
 * @param styleId - Style ID to check
 * @returns true if style exists
 */
export async function styleExists(ctx: DocumentContext, styleId: string): Promise<boolean> {
  if (isBuiltInStyle(styleId)) return true;
  const customDefs = await ctx.computeBridge.getAllCustomCellStyles();
  return customDefs.some((s) => s.id === styleId);
}

/**
 * Get the count of custom styles.
 *
 * @param ctx - Store context
 * @returns Number of custom styles
 */
export async function getCustomStyleCount(ctx: DocumentContext): Promise<number> {
  const customDefs = await ctx.computeBridge.getAllCustomCellStyles();
  return customDefs.filter((d) => !d.builtIn).length;
}

/**
 * Get just the format from a style.
 *
 * @param ctx - Store context
 * @param styleId - Style ID
 * @returns Promise of the format, or undefined if style not found
 */
export async function getStyleFormat(
  ctx: DocumentContext,
  styleId: string,
): Promise<CellFormat | undefined> {
  const style = await getStyleById(ctx, styleId);
  return style?.format;
}

// =============================================================================
// Protection Helper Functions
// =============================================================================

/**
 * Check if a cell is locked (for protection purposes).
 * Reads from CellFormat.locked - defaults to true per Excel convention.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of true if cell is locked
 */
export async function isLocked(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const format = await getFormat(ctx, sheetId, row, col);
  return format?.locked ?? true;
}

/**
 * Check if a cell's formula should be hidden in formula bar.
 * Reads from CellFormat.hidden - defaults to false.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of true if formula should be hidden
 */
export async function isFormulaHidden(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const format = await getFormat(ctx, sheetId, row, col);
  return format?.hidden ?? false;
}

/**
 * Set the locked status for a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param locked - Whether the cell should be locked
 */
export function setLocked(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  locked: boolean,
): void {
  setFormat(ctx, sheetId, row, col, { locked });
}

/**
 * Set the formula hidden status for a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param hidden - Whether the formula should be hidden
 */
export function setFormulaHidden(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  hidden: boolean,
): void {
  setFormat(ctx, sheetId, row, col, { hidden });
}

/**
 * Set locked status for a range of cells.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Cell range
 * @param locked - Whether cells should be locked
 */
export function setLockedRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  locked: boolean,
): void {
  void ctx.computeBridge.setFormatForRanges(sheetId, [rangeToTuple(range)], {
    locked,
  });
}

// =============================================================================
// Row/Column Format Operations
// =============================================================================

/**
 * Get format for a row.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @returns Promise of row format or undefined
 */
export async function getRowFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
): Promise<CellFormat | undefined> {
  // Row format is resolved by Rust during getActiveCell/getCellFormat.
  // Query a cell in the row to get the row-level format contribution.
  // Without a dedicated CB method, return undefined.
  // The effective format (via getCellFormat) already includes row format.
  void ctx;
  void sheetId;
  void row;
  return undefined;
}

/**
 * Set format for a row.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param format - Partial format to merge
 * @param _origin - Transaction origin (handled by Rust)
 */
export function setRowFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  format: Partial<CellFormat>,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.setRowFormat(sheetId, row, format);
}

/**
 * Clear format for a row.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param _origin - Transaction origin (handled by Rust)
 */
export function clearRowFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.setRowFormat(sheetId, row, {});
}

/**
 * Get format for a column.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @returns Promise of column format or undefined
 */
export async function getColFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
): Promise<CellFormat | undefined> {
  // Column format is resolved by Rust during getCellFormat.
  // Without a dedicated CB method, return undefined.
  void ctx;
  void sheetId;
  void col;
  return undefined;
}

/**
 * Set format for a column.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @param format - Partial format to merge
 * @param _origin - Transaction origin (handled by Rust)
 */
export function setColFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  format: Partial<CellFormat>,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.setColFormat(sheetId, col, format);
}

/**
 * Clear format for a column.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @param _origin - Transaction origin (handled by Rust)
 */
export function clearColFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.setColFormat(sheetId, col, {});
}

// =============================================================================
// Format Inheritance
// =============================================================================

/**
 * Default format values used when no format is specified at any level.
 * These match Excel's "Normal" style defaults.
 */
export const DEFAULT_FORMAT: CellFormat = {
  fontFamily: 'Calibri',
  fontSize: 11,
  fontColor: '#000000',
  bold: false,
  italic: false,
  underlineType: 'none',
  strikethrough: false,
  horizontalAlign: 'general',
  verticalAlign: 'bottom',
  wrapText: false,
  locked: true,
  hidden: false,
};

/**
 * Merge two CellFormat objects with property-level precedence.
 * Properties from `higher` override `lower`, but only if defined.
 */
function mergeFormats(
  lower: CellFormat | undefined,
  higher: CellFormat | undefined,
): CellFormat | undefined {
  if (!lower && !higher) return undefined;
  if (!lower) return higher;
  if (!higher) return lower;
  return { ...lower, ...higher };
}

/**
 * Get the effective (computed) format for a cell.
 *
 * Format inheritance follows Excel's priority chain:
 * 1. Cell format (highest priority)
 * 2. Row format
 * 3. Column format
 * 4. Default format (lowest priority)
 *
 * Rust resolves this entire chain via getCellFormat. This function
 * delegates to ComputeBridge for the fully-resolved format.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of the effective format with all inherited properties resolved
 */
export async function getEffectiveFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellFormat> {
  const rangeData = await ctx.computeBridge.queryRange(sheetId, row, col, row, col);
  const cells = rangeData?.cells;
  if (cells && cells.length > 0 && cells[0].format) {
    return mergeFormats(DEFAULT_FORMAT, cells[0].format) ?? DEFAULT_FORMAT;
  }
  return DEFAULT_FORMAT;
}

/**
 * Check if a cell has any format set directly (not inherited).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Promise of true if the cell has a direct format
 */
export async function hasCellFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const format = await getFormat(ctx, sheetId, row, col);
  return format !== undefined;
}

/**
 * Check if a row has any format set.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @returns Promise of true if the row has a format
 */
export async function hasRowFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
): Promise<boolean> {
  const format = await getRowFormat(ctx, sheetId, row);
  return format !== undefined;
}

/**
 * Check if a column has any format set.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @returns Promise of true if the column has a format
 */
export async function hasColFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
): Promise<boolean> {
  const format = await getColFormat(ctx, sheetId, col);
  return format !== undefined;
}

/**
 * Get the source of a specific format property for a cell.
 * In the CB model, Rust resolves the full inheritance chain.
 * Without separate row/col format queries, returns 'cell' if present,
 * otherwise 'default'.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param property - The format property to check
 * @returns Promise of the source: 'cell', 'row', 'column', or 'default'
 */
export async function getFormatPropertySource(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  property: keyof CellFormat,
): Promise<'cell' | 'row' | 'column' | 'default'> {
  const cellFormat = await getFormat(ctx, sheetId, row, col);
  if (cellFormat && property in cellFormat && cellFormat[property] !== undefined) {
    return 'cell';
  }

  const rowFormat = await getRowFormat(ctx, sheetId, row);
  if (rowFormat && property in rowFormat && rowFormat[property] !== undefined) {
    return 'row';
  }

  const colFormat = await getColFormat(ctx, sheetId, col);
  if (colFormat && property in colFormat && colFormat[property] !== undefined) {
    return 'column';
  }

  return 'default';
}
