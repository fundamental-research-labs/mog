/**
 * Clipboard Data Builder
 *
 * Builds ClipboardData from cell ranges for the clipboard-machine.
 * Captures all data needed for paste special operations:
 * - value: computed result (for paste values)
 * - formula: formula string (for paste formulas)
 * - format: cell formatting (for paste formats)
 *
 */

import type { Comment } from '@mog-sdk/contracts/api';
import type { ConditionalFormat } from '@mog-sdk/contracts/conditional-format';
import type { CellFormat, SheetId } from '@mog-sdk/contracts/core';
import type { RangeSchema } from '@mog-sdk/contracts/schema';
import type { StoreCellData } from '@mog-sdk/contracts/store';
// Replaced runtime Merges import with inline type definition.
// Only the position fields are used by clipboard merge capture logic.
import type {
  ClipboardCellData,
  ClipboardData,
  RelativeComment,
  RelativeConditionalFormat,
  RelativeMerge,
  RelativeValidation,
} from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import { normalizeRange } from './clipboard-utils';

/** Resolved merged region with position fields used by clipboard capture. */
interface ResolvedMergedRegion {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Store operations interface for reading cell data.
 * Decouples builder from SpreadsheetStore implementation.
 */
export interface ClipboardStoreReader {
  getCellData(sheetId: SheetId, row: number, col: number): StoreCellData | undefined;
  getCellFormat(sheetId: SheetId, row: number, col: number): CellFormat | undefined;
  /**
   * Get all merged regions in a sheet (
   * Used to capture merges within the copied selection.
   */
  getMergedRegions?(sheetId: SheetId): ResolvedMergedRegion[];
  /**
   * Check if a row is hidden (Hidden/Filtered Row Handling).
   * Used to skip hidden rows during copy operations (Excel behavior).
   * Returns true if the row is hidden (by user hide or filter).
   */
  isRowHidden?(sheetId: SheetId, row: number): boolean;
  /**
   * Check if a column is hidden (Hidden/Filtered Column Handling).
   * Returns true if the column is hidden.
   */
  isColHidden?(sheetId: SheetId, col: number): boolean;
  /**
   * Get all range schemas (data validation rules) in a sheet.
   * Data Validation - Clipboard integration
   * Used to capture validation within the copied selection.
   */
  getRangeSchemas?(sheetId: SheetId): RangeSchema[];
  /**
   * Get comments for a cell by row/column position.
   * Comments in Clipboard - captures comments when copying cells.
   */
  getCommentsForCellAt?(sheetId: SheetId, row: number, col: number): Comment[];
  /**
   * Get all conditional formatting rules for a sheet.
   * Used to capture CF rules within the copied selection.
   */
  getConditionalFormats?(sheetId: SheetId): ConditionalFormat[];
  /**
   * Check if a cell has a hidden formula.
   * Returns true if the sheet is protected AND the cell is locked AND
   * the cell has the "hidden formula" flag set.
   * When true, the formula should not be included in clipboard data.
   */
  isFormulaHidden?(sheetId: SheetId, row: number, col: number): boolean;
  /**
   * Get column width for a specific column.
   * Returns width in pixels, or undefined for default width.
   */
  getColumnWidth?(sheetId: SheetId, col: number): number | undefined;
}

/**
 * Options for building clipboard data.
 */
export interface BuildClipboardDataOptions {
  /**
   * Skip hidden rows and columns during copy (Excel behavior).
   * When true, hidden rows/columns are not included in the clipboard data.
   * Defaults to true to match Excel behavior.
   */
  skipHidden?: boolean;
}

export interface SparseClipboardCellEntry {
  row: number;
  col: number;
  cellData?: StoreCellData;
  format?: CellFormat;
  comments?: RelativeComment[];
  hideFormula?: boolean;
}

// =============================================================================
// Main Builder Function
// =============================================================================

/**
 * Build ClipboardData from cell ranges.
 *
 * Maps CellData fields to ClipboardCellData:
 * - CellData.computed (or raw) → value (for paste values)
 * - CellData.formula → formula (for paste formulas)
 * - CellFormat → format (for paste formats)
 *
 * @param ranges - The ranges being copied/cut
 * @param sheetId - Source sheet ID
 * @param store - Store reader for accessing cell data
 * @param options - Optional build options (skipHidden, etc.)
 * @returns ClipboardData ready for clipboard-machine
 */
export function buildClipboardData(
  ranges: CellRange[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
  options: BuildClipboardDataOptions = {},
): ClipboardData {
  const cells: Record<string, ClipboardCellData> = {};
  // Excel behavior: normal copy includes ALL cells (including hidden rows/cols).
  // Only paste-to-filtered-range skips hidden destination rows.
  const { skipHidden = false } = options;

  for (const range of ranges) {
    const normalized = normalizeRange(range);

    // Track visible row/col indices for proper relative positioning
    // When skipping hidden rows/cols, we need to compact the output
    let visibleRowIndex = 0;

    for (let row = normalized.startRow; row <= normalized.endRow; row++) {
      // Skip hidden rows if enabled
      if (skipHidden && store.isRowHidden?.(sheetId, row)) {
        continue;
      }

      let visibleColIndex = 0;

      for (let col = normalized.startCol; col <= normalized.endCol; col++) {
        // Skip hidden columns if enabled
        if (skipHidden && store.isColHidden?.(sheetId, col)) {
          continue;
        }

        // Normal copies keep sparse offsets relative to the original selection
        // origin. Hidden-row compaction is the only mode that rewrites offsets.
        const key = skipHidden
          ? `${visibleRowIndex},${visibleColIndex}`
          : `${row - normalized.startRow},${col - normalized.startCol}`;

        const cellData = store.getCellData(sheetId, row, col);
        const format = store.getCellFormat(sheetId, row, col);

        // Capture comments for this cell
        const comments = captureCommentsForCell(sheetId, row, col, store);

        // Check if formula should be hidden (protected cell with hidden formula)
        const hideFormula = store.isFormulaHidden?.(sheetId, row, col) ?? false;

        const clipboardCell = buildClipboardCellData(cellData, format, comments, hideFormula);

        if (hasContent(clipboardCell)) {
          cells[key] = clipboardCell;
        }

        visibleColIndex++;
      }

      visibleRowIndex++;
    }
  }

  // Capture merges within the selection
  // Note: Merges in hidden areas will be captured but may not paste correctly
  // This matches Excel behavior where copying filtered data can lose merge info
  const merges = captureMergesInRanges(ranges, sheetId, store);

  // Capture validation rules within the selection
  const validation = captureValidationInRanges(ranges, sheetId, store);

  // Capture conditional formatting rules within the selection
  const conditionalFormatting = captureCFInRanges(ranges, sheetId, store);

  // Capture source column widths for "Keep Source Column Widths" option
  const sourceColumnWidths = captureColumnWidths(ranges, sheetId, store, skipHidden);

  return {
    sourceRanges: ranges,
    cells,
    sourceSheetId: sheetId,
    merges: merges.length > 0 ? merges : undefined,
    validation: validation.length > 0 ? validation : undefined,
    conditionalFormatting: conditionalFormatting.length > 0 ? conditionalFormatting : undefined,
    sourceColumnWidths: sourceColumnWidths.some((w) => w !== undefined)
      ? sourceColumnWidths
      : undefined,
  };
}

/**
 * Build ClipboardData from already sparse absolute-position entries.
 *
 * Whole-row and whole-column copies must keep offsets relative to the original
 * full-shape selection without enumerating the full sheet extent. This entry
 * point shares the same cell conversion and metadata capture contract as the
 * rectangular builder while letting the caller supply only populated cells.
 */
export function buildSparseClipboardData(
  ranges: CellRange[],
  sheetId: SheetId,
  entries: SparseClipboardCellEntry[],
  store: ClipboardStoreReader,
  options: BuildClipboardDataOptions = {},
): ClipboardData {
  const cells: Record<string, ClipboardCellData> = {};
  const { skipHidden = false } = options;
  const firstRange = ranges[0];
  if (!firstRange) {
    return {
      sourceRanges: ranges,
      cells,
      sourceSheetId: sheetId,
    };
  }

  const origin = normalizeRange(firstRange);
  const sortedEntries = [...entries].sort((a, b) => a.row - b.row || a.col - b.col);
  const visibleRowOffsets = skipHidden
    ? buildSparseVisibleOffsetMap(sortedEntries, sheetId, store, 'row')
    : null;
  const visibleColOffsets = skipHidden
    ? buildSparseVisibleOffsetMap(sortedEntries, sheetId, store, 'col')
    : null;

  for (const entry of sortedEntries) {
    if (!isCellInRanges(entry.row, entry.col, ranges)) continue;

    const rowOffset = skipHidden ? visibleRowOffsets?.get(entry.row) : entry.row - origin.startRow;
    const colOffset = skipHidden ? visibleColOffsets?.get(entry.col) : entry.col - origin.startCol;
    if (rowOffset === undefined || colOffset === undefined) continue;

    const clipboardCell = buildClipboardCellData(
      entry.cellData,
      entry.format,
      entry.comments ?? captureCommentsForCell(sheetId, entry.row, entry.col, store),
      entry.hideFormula,
    );

    if (hasContent(clipboardCell)) {
      cells[`${rowOffset},${colOffset}`] = clipboardCell;
    }
  }

  const merges = captureMergesInRanges(ranges, sheetId, store);
  const validation = captureValidationInRanges(ranges, sheetId, store);
  const conditionalFormatting = captureCFInRanges(ranges, sheetId, store);
  const sourceColumnWidths = captureColumnWidths(ranges, sheetId, store, skipHidden);

  return {
    sourceRanges: ranges,
    cells,
    sourceSheetId: sheetId,
    merges: merges.length > 0 ? merges : undefined,
    validation: validation.length > 0 ? validation : undefined,
    conditionalFormatting: conditionalFormatting.length > 0 ? conditionalFormatting : undefined,
    sourceColumnWidths: sourceColumnWidths.some((w) => w !== undefined)
      ? sourceColumnWidths
      : undefined,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function isCellInRanges(row: number, col: number, ranges: CellRange[]): boolean {
  return ranges.some((range) => {
    const normalized = normalizeRange(range);
    return (
      row >= normalized.startRow &&
      row <= normalized.endRow &&
      col >= normalized.startCol &&
      col <= normalized.endCol
    );
  });
}

function buildSparseVisibleOffsetMap(
  entries: SparseClipboardCellEntry[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
  axis: 'row' | 'col',
): Map<number, number> {
  const result = new Map<number, number>();
  let visibleIndex = 0;
  const indices = new Set(entries.map((entry) => (axis === 'row' ? entry.row : entry.col)));
  for (const index of [...indices].sort((a, b) => a - b)) {
    const hidden =
      axis === 'row' ? store.isRowHidden?.(sheetId, index) : store.isColHidden?.(sheetId, index);
    if (hidden) continue;
    if (!result.has(index)) {
      result.set(index, visibleIndex);
      visibleIndex++;
    }
  }
  return result;
}

/**
 * Capture column widths for copied columns.
 *
 * Returns an array of column widths indexed by relative column position.
 * undefined values indicate default column width should be used.
 *
 * @param ranges - The ranges being copied/cut
 * @param sheetId - Source sheet ID
 * @param store - Store reader for accessing column widths
 * @param skipHidden - Whether to skip hidden columns
 * @returns Array of column widths (or undefined for default)
 */
function captureColumnWidths(
  ranges: CellRange[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
  skipHidden: boolean,
): (number | undefined)[] {
  // Skip if store doesn't support column width reading
  if (!store.getColumnWidth) {
    return [];
  }

  const firstRange = ranges[0];
  if (!firstRange) {
    return [];
  }

  const normalized = normalizeRange(firstRange);
  const widths: (number | undefined)[] = [];
  let visibleColIndex = 0;

  for (let col = normalized.startCol; col <= normalized.endCol; col++) {
    // Skip hidden columns if enabled
    if (skipHidden && store.isColHidden?.(sheetId, col)) {
      continue;
    }

    const width = store.getColumnWidth(sheetId, col);
    // Store the width at the visible column index
    widths[visibleColIndex] = width;
    visibleColIndex++;
  }

  return widths;
}

/**
 * Capture merges that are fully contained within the copied ranges.
 * Converts absolute positions to relative offsets from range origin.
 *
 * A merge is captured if it's fully contained within ANY of the source ranges.
 * Partial overlaps are NOT captured (per Excel behavior).
 */
function captureMergesInRanges(
  ranges: CellRange[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
): RelativeMerge[] {
  // Skip if store doesn't support merge reading
  if (!store.getMergedRegions) {
    return [];
  }

  const allMerges = store.getMergedRegions(sheetId);
  const relativeMerges: RelativeMerge[] = [];

  // Use first range as the origin for relative positioning
  const firstRange = ranges[0];
  if (!firstRange) {
    return [];
  }

  const normalized = normalizeRange(firstRange);
  const originRow = normalized.startRow;
  const originCol = normalized.startCol;

  for (const merge of allMerges) {
    // Check if merge is fully contained in any of the ranges
    const isContained = ranges.some((range) => {
      const r = normalizeRange(range);
      return (
        merge.startRow >= r.startRow &&
        merge.endRow <= r.endRow &&
        merge.startCol >= r.startCol &&
        merge.endCol <= r.endCol
      );
    });

    if (isContained) {
      // Convert to relative offsets from the first range's origin
      relativeMerges.push({
        startRowOffset: merge.startRow - originRow,
        startColOffset: merge.startCol - originCol,
        endRowOffset: merge.endRow - originRow,
        endColOffset: merge.endCol - originCol,
      });
    }
  }

  return relativeMerges;
}

/**
 * Capture validation rules that overlap with the copied ranges.
 * Converts absolute positions to relative offsets from range origin.
 *
 * A validation rule is captured if ANY of its ranges overlaps with
 * ANY of the copied ranges. The captured validation stores:
 * - The schema definition (type, constraints, enforcement, ui)
 * - Range offsets relative to the first copied range's origin
 *
 * Only the overlapping portion of each schema range is captured (matching
 * the conditional-format capture path), so a partial copy carries only the
 * portion of the rule that was actually inside the selection.
 *
 * IdentityRangeSchemaRef.startId/endId are encoded by the kernel as
 * "row:col" strings (see kernel/src/api/worksheet/operations/validation-helpers.ts
 * parseRefIdSimple); refs that don't resolve to a row/col pair (e.g. cross-sheet
 * enumSource refs) are skipped.
 */
function captureValidationInRanges(
  ranges: CellRange[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
): RelativeValidation[] {
  if (!store.getRangeSchemas) {
    return [];
  }

  const allSchemas = store.getRangeSchemas(sheetId);
  if (allSchemas.length === 0) {
    return [];
  }

  const firstRange = ranges[0];
  if (!firstRange) {
    return [];
  }

  const originNormalized = normalizeRange(firstRange);
  const originRow = originNormalized.startRow;
  const originCol = originNormalized.startCol;

  const relativeValidations: RelativeValidation[] = [];

  for (const schema of allSchemas) {
    const overlappingRanges: RelativeValidation['ranges'] = [];

    for (const ref of schema.ranges) {
      // Cross-sheet refs (e.g. enumSource pointing to another sheet) don't
      // apply at this sheet's positions — skip.
      if (ref.sheetId && ref.sheetId !== sheetId) continue;

      const start = parseRowColRefId(ref.startId);
      const end = parseRowColRefId(ref.endId);
      if (!start || !end) continue;

      const schemaRange: CellRange = {
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(start.row, end.row),
        endCol: Math.max(start.col, end.col),
      };

      for (const copiedRange of ranges) {
        const copiedNorm = normalizeRange(copiedRange);
        const overlap = getRangeOverlap(schemaRange, copiedNorm);
        if (!overlap) continue;

        overlappingRanges.push({
          startRowOffset: overlap.startRow - originRow,
          startColOffset: overlap.startCol - originCol,
          endRowOffset: overlap.endRow - originRow,
          endColOffset: overlap.endCol - originCol,
        });
      }
    }

    if (overlappingRanges.length === 0) continue;

    relativeValidations.push({
      schema: {
        type: schema.schema.type,
        constraints: schema.schema.constraints as Record<string, unknown> | undefined,
      },
      enforcement: schema.enforcement,
      ui: schema.ui,
      ranges: overlappingRanges,
    });
  }

  return relativeValidations;
}

/**
 * Parse the kernel's "row:col" ref ID encoding used by IdentityRangeSchemaRef.
 * Returns null on any other format (e.g. opaque CellId UUIDs that we can't
 * resolve without a position lookup).
 */
function parseRowColRefId(id: string): { row: number; col: number } | null {
  const colonIdx = id.indexOf(':');
  if (colonIdx <= 0) return null;
  const row = parseInt(id.substring(0, colonIdx), 10);
  const col = parseInt(id.substring(colonIdx + 1), 10);
  if (Number.isNaN(row) || Number.isNaN(col) || row < 0 || col < 0) return null;
  return { row, col };
}

/**
 * Capture conditional formatting rules that overlap with the copied ranges.
 * Converts absolute positions to relative offsets from range origin.
 *
 * A CF rule is captured if ANY of its ranges overlaps with ANY of the copied ranges.
 * The captured CF stores:
 * - The rule definition (type, operator, values, style, etc.)
 * - Range offsets relative to the first copied range's origin
 *
 * Note: Only the overlapping portion of CF ranges is captured, not the entire CF range.
 * This matches Excel behavior.
 */
function captureCFInRanges(
  ranges: CellRange[],
  sheetId: SheetId,
  store: ClipboardStoreReader,
): RelativeConditionalFormat[] {
  // Skip if store doesn't support CF reading
  if (!store.getConditionalFormats) {
    return [];
  }

  const allFormats = store.getConditionalFormats(sheetId);
  if (allFormats.length === 0) {
    return [];
  }

  const relativeCFs: RelativeConditionalFormat[] = [];

  // Use first range as the origin for relative positioning
  const firstRange = ranges[0];
  if (!firstRange) {
    return [];
  }

  const normalized = normalizeRange(firstRange);
  const originRow = normalized.startRow;
  const originCol = normalized.startCol;

  for (const format of allFormats) {
    // Check if any CF range overlaps with any copied range
    const cfRanges = format.ranges ?? [];
    const overlappingRanges: RelativeConditionalFormat['ranges'] = [];

    for (const cfRange of cfRanges) {
      // Check overlap with each copied range
      for (const copiedRange of ranges) {
        const copiedNorm = normalizeRange(copiedRange);
        const overlap = getRangeOverlap(cfRange, copiedNorm);

        if (overlap) {
          // Convert overlap to relative offsets from clipboard origin
          overlappingRanges.push({
            startRowOffset: overlap.startRow - originRow,
            startColOffset: overlap.startCol - originCol,
            endRowOffset: overlap.endRow - originRow,
            endColOffset: overlap.endCol - originCol,
          });
        }
      }
    }

    // Only capture if there are overlapping ranges
    if (overlappingRanges.length > 0) {
      // Clone rules without IDs (new IDs will be generated on paste)
      const clonedRules = format.rules.map((rule) => {
        // Create a shallow clone, preserving all properties except 'id'
        const { id: _id, ...ruleWithoutId } = rule;
        return ruleWithoutId as RelativeConditionalFormat['rules'][number];
      });

      relativeCFs.push({
        rules: clonedRules,
        ranges: overlappingRanges,
      });
    }
  }

  return relativeCFs;
}

/**
 * Calculate the overlap between two ranges.
 * Returns the overlapping region, or null if they don't overlap.
 */
function getRangeOverlap(
  range1: CellRange,
  range2: CellRange,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const startRow = Math.max(range1.startRow, range2.startRow);
  const startCol = Math.max(range1.startCol, range2.startCol);
  const endRow = Math.min(range1.endRow, range2.endRow);
  const endCol = Math.min(range1.endCol, range2.endCol);

  // Check if there's an overlap (all conditions must be true)
  if (startRow <= endRow && startCol <= endCol) {
    return { startRow, startCol, endRow, endCol };
  }

  return null;
}

/**
 * Capture comments for a cell at a given position.
 * Comments in Clipboard
 *
 * Converts Comment objects to RelativeComment for clipboard storage.
 * Returns undefined if no comments exist or store doesn't support comment reading.
 */
function captureCommentsForCell(
  sheetId: SheetId,
  row: number,
  col: number,
  store: ClipboardStoreReader,
): RelativeComment[] | undefined {
  const comments = store.getCommentsForCellAt?.(sheetId, row, col);
  if (!comments || comments.length === 0) {
    return undefined;
  }

  // Convert to RelativeComment format
  // Note: rowOffset and colOffset are 0 since each comment is stored per-cell
  // The position offset is already captured in the cell key (e.g., "0,0", "1,2")
  return comments.map(
    (comment): RelativeComment => ({
      rowOffset: 0,
      colOffset: 0,
      author: comment.author,
      authorId: comment.authorId,
      content: extractPlainTextFromComment(comment),
      createdAt: comment.createdAt ?? Date.now(),
      resolved: comment.resolved,
      commentType: comment.commentType,
      threadId: comment.threadId,
      parentId: comment.parentId,
    }),
  );
}

/**
 * Extract plain text content from a Comment's RichText content.
 * For clipboard purposes, we flatten rich text to plain string.
 */
function extractPlainTextFromComment(comment: Comment): string {
  if (typeof comment.content === 'string') {
    return comment.content;
  }
  if (Array.isArray(comment.runs) && comment.runs.length > 0) {
    return comment.runs.map((segment) => segment.text ?? '').join('');
  }
  return '';
}

/**
 * Build ClipboardCellData from store cell data, CellFormat, and comments.
 *
 * @param cellData - The cell data to convert
 * @param format - Cell format (styles)
 * @param comments - Relative comments for the cell
 * @param hideFormula - If true, exclude formula from clipboard
 * (used for protected cells with hidden formula flag)
 */
function buildClipboardCellData(
  cellData: StoreCellData | undefined,
  format: CellFormat | undefined,
  comments?: RelativeComment[],
  hideFormula?: boolean,
): ClipboardCellData {
  const result: ClipboardCellData = { raw: undefined };

  if (cellData) {
    // Use computed value for formulas, raw value for non-formula cells
    result.raw = cellData.formula !== undefined ? cellData.computed : (cellData.raw ?? undefined);

    // Store formula without '=' for paste formulas
    // Skip formula if it's hidden (protected cell with hidden formula flag)
    if (cellData.formula && !hideFormula) {
      result.formula = cellData.formula;
    }

    // Capture hyperlink if present
    if (cellData.hyperlink) {
      result.hyperlink = cellData.hyperlink;
    }
  }

  if (format && Object.keys(format).length > 0) {
    result.format = { ...format };
  }

  // Include comments if present
  if (comments && comments.length > 0) {
    result.comments = comments;
  }

  return result;
}

/**
 * Check if clipboard cell has content worth storing.
 */
function hasContent(data: ClipboardCellData): boolean {
  if (data.raw !== undefined && data.raw !== null) return true;
  if (data.formula) return true;
  if (data.format && Object.keys(data.format as object).length > 0) return true;
  // Comments are content too
  if (data.comments && data.comments.length > 0) return true;
  // Hyperlinks are content too
  if (data.hyperlink) return true;
  return false;
}

/**
 * Get display value for TSV/text clipboard format.
 */
export function getClipboardCellDisplayValue(cell: ClipboardCellData): string {
  if (cell.raw === undefined || cell.raw === null) return '';

  // Handle error values
  if (typeof cell.raw === 'object' && 'type' in cell.raw) {
    const errorValue = cell.raw as { type: string; value: string };
    if (errorValue.type === 'error') return errorValue.value;
  }

  return String(cell.raw);
}
