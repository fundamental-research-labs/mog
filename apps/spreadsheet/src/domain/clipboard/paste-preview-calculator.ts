/**
 * Paste Preview Calculator
 *
 * Calculates what a paste operation would look like WITHOUT writing to Yjs.
 * Used for showing a live preview when hovering over paste dropdown options.
 *
 * This module is pure - it takes clipboard data and paste options, and returns
 * preview cell data that can be rendered by the selection layer.
 *
 */

import type {
  ClipboardCellData,
  ClipboardData,
  PasteMenuOption,
  PasteSpecialOptions,
} from '@mog-sdk/contracts/actors';
import type { CellFormat, CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord, PreviewCellData } from '@mog-sdk/contracts/rendering';
import { parseCellKey } from './clipboard-utils';
import {
  filterBlanks,
  filterByPasteType,
  getClipboardDimensions,
  transposeData,
} from './paste-executor';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of preview calculation
 */
export interface PastePreviewResult {
  /** Preview cells to render */
  cells: PreviewCellData[];
  /** The target range that would be affected */
  targetRange: CellRange;
  /** Number of cells that would be affected */
  cellCount: number;
}

/**
 * Context for getting current cell values (for showing what would be replaced)
 */
export interface PreviewContext {
  /** Get formatted display value for a cell */
  getDisplayValue?: (sheetId: SheetId, row: number, col: number) => string;
  /** Get current format for a cell */
  getCellFormat?: (sheetId: SheetId, row: number, col: number) => Partial<CellFormat> | undefined;
}

// =============================================================================
// Paste Option to PasteSpecialOptions Mapping
// =============================================================================

/**
 * Convert a PasteMenuOption (from dropdown) to PasteSpecialOptions
 */
export function pasteOptionToSpecialOptions(option: PasteMenuOption): PasteSpecialOptions {
  switch (option) {
    case 'all':
      return {}; // Default: paste everything
    case 'valuesOnly':
      return { values: true };
    case 'formulas':
      return { formulas: true };
    case 'formatting':
      return { formats: true };
    case 'keepSourceFormatting':
      return {}; // Same as all but preserves original formatting (default)
    case 'matchDestination':
      return { values: true }; // Only values, uses destination formatting
    case 'transpose':
      return { transpose: true };
    case 'valuesAndFormatting':
      return { values: true, formats: true };
    case 'pasteLink':
      return { pasteLink: true };
    case 'columnWidths':
      // Paste all data and also apply source column widths
      return { columnWidths: true };
    default:
      return {};
  }
}

// =============================================================================
// Preview Calculation
// =============================================================================

/**
 * Calculate what a paste would look like without executing it.
 *
 * @param clipboardData - The clipboard data to preview
 * @param targetCell - Where the paste would start (top-left cell)
 * @param sheetId - The target sheet
 * @param option - The paste option being previewed
 * @param _context - Optional context for getting current cell values (reserved for future use)
 * @returns Preview result with cells and target range
 */
export function calculatePastePreview(
  clipboardData: ClipboardData,
  targetCell: CellCoord,
  sheetId: SheetId,
  option: PasteMenuOption,
  _context?: PreviewContext,
): PastePreviewResult {
  // Convert paste option to special options
  const options = pasteOptionToSpecialOptions(option);

  // Apply transformations (same as paste-executor)
  let processedData = clipboardData;

  if (options.transpose) {
    processedData = transposeData(processedData);
  }

  processedData = filterByPasteType(processedData, options);

  if (options.skipBlanks) {
    processedData = filterBlanks(processedData);
  }

  // Calculate dimensions
  const dimensions = getClipboardDimensions(processedData);

  // Calculate target range
  const targetRange: CellRange = {
    startRow: targetCell.row,
    startCol: targetCell.col,
    endRow: targetCell.row + Math.max(0, dimensions.rows - 1),
    endCol: targetCell.col + Math.max(0, dimensions.cols - 1),
  };

  // Build preview cells
  const previewCells: PreviewCellData[] = [];
  const { values: valuesOnly, formulas: formulasOnly, formats: formatsOnly, pasteLink } = options;
  const pasteAll = !valuesOnly && !formulasOnly && !formatsOnly && !pasteLink;

  // Get source range info for Paste Link
  const sourceRange = processedData.sourceRanges[0];
  const sourceStartRow = sourceRange?.startRow ?? 0;
  const sourceStartCol = sourceRange?.startCol ?? 0;

  for (const [key, cellData] of Object.entries(processedData.cells)) {
    const { row: relRow, col: relCol } = parseCellKey(key);
    const targetRow = targetCell.row + relRow;
    const targetCol = targetCell.col + relCol;

    // Build preview cell
    const previewCell: PreviewCellData = {
      row: targetRow,
      col: targetCol,
      displayValue: '',
      format: undefined,
      hasFormula: false,
    };

    // Handle Paste Link: show formula reference
    if (pasteLink) {
      let sourceRow: number;
      let sourceCol: number;
      if (options.transpose) {
        sourceRow = sourceStartRow + relCol;
        sourceCol = sourceStartCol + relRow;
      } else {
        sourceRow = sourceStartRow + relRow;
        sourceCol = sourceStartCol + relCol;
      }
      // Create a simplified reference display
      const colLetter = numberToColumnLetter(sourceCol);
      const isSameSheet = processedData.sourceSheetId === sheetId;
      previewCell.displayValue = isSameSheet
        ? `=${colLetter}${sourceRow + 1}`
        : `=...!${colLetter}${sourceRow + 1}`;
      previewCell.hasFormula = true;
      previewCells.push(previewCell);
      continue;
    }

    // Handle value/formula paste
    if (pasteAll || valuesOnly || formulasOnly) {
      previewCell.displayValue = formatPreviewValue(cellData, valuesOnly ?? false);
      previewCell.hasFormula = !valuesOnly && !!cellData.formula;
    }

    // Handle format paste
    if ((pasteAll || formatsOnly) && cellData.format) {
      previewCell.format = cellData.format as Partial<CellFormat>;
    }

    // Only include if there's something to show
    const hasContent =
      previewCell.displayValue !== '' || previewCell.format !== undefined || previewCell.hasFormula;

    if (hasContent) {
      previewCells.push(previewCell);
    }
  }

  return {
    cells: previewCells,
    targetRange,
    cellCount: previewCells.length,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a cell value for preview display
 */
function formatPreviewValue(cellData: ClipboardCellData, valuesOnly: boolean): string {
  // If pasting values only, show the computed value
  if (valuesOnly || !cellData.formula) {
    return formatValue(cellData.raw);
  }

  // If pasting formula, show the formula (abbreviated if long)
  const formula = cellData.formula;
  const prefixed = formula;
  if (prefixed.length > 20) {
    return `${prefixed.substring(0, 17)}...`;
  }
  return prefixed;
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    // Format numbers nicely
    if (Number.isInteger(value)) {
      return value.toString();
    }
    // Limit decimal places for display
    return value.toFixed(2).replace(/\.?0+$/, '');
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const obj = value as Record<string, unknown>;
    if (obj.type === 'error' && typeof obj.value === 'string') {
      return obj.value;
    }
  }
  return String(value);
}

/**
 * Convert column number to letter (0 = A, 1 = B, etc.)
 */
function numberToColumnLetter(col: number): string {
  let result = '';
  let num = col;
  while (num >= 0) {
    result = String.fromCharCode((num % 26) + 65) + result;
    num = Math.floor(num / 26) - 1;
  }
  return result;
}

// =============================================================================
// Preview Availability Check
// =============================================================================

/**
 * Check if preview is available for the given paste option.
 * Some options may not support preview (e.g., Paste Special dialog).
 */
export function isPastePreviewAvailable(option: PasteMenuOption): boolean {
  // Paste Special dialog opens a dialog, no inline preview
  // All other options support preview
  return option !== 'valuesAndFormatting'; // This one maps to Paste Special dialog
}
