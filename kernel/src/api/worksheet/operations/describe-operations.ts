/**
 * Describe Operations Module
 *
 * Standalone functions for LLM presentation: describe, describeRange, summarize.
 * Extracted from WorksheetImpl for modular organization.
 *
 * RESPONSIBILITIES:
 * - describe: Build a compact string representation of a single cell
 * - describeRange: Build a formatted multi-cell range description with formula analysis and context
 * - summarize: Build a sheet overview with metadata, charts, tables, named ranges, and sample data
 *
 * ARCHITECTURE:
 * - All functions take (ctx: DocumentContext, sheetId: string) as first two params
 * - Uses ComputeBridge for data queries
 * - Returns formatted strings suitable for LLM consumption
 */

import type { CellFormat } from './shared';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { SummaryOptions } from '@mog-sdk/contracts/api';

import type { RangeCellData, RangeQueryResult } from '../../../bridges/compute/compute-types.gen';
import type { DocumentContext } from './shared';

import { isCellError } from '@mog/spreadsheet-utils/errors';

import { getAll as getAllCharts } from '../../../domain/charts/chart-store';
import * as NamedRanges from '../../../domain/formulas/named-ranges';
import { getMeta } from '../../../domain/sheets/sheet-meta';
import * as TablesCore from '../../../domain/tables/core';

import { resolveCell } from '../../internal/address-resolver';
import {
  MAX_DESCRIBE_OUTPUT_CHARS,
  MAX_RANGE_BOUNDING_BOX,
  MAX_RANGE_CELLS,
  MAX_SUMMARY_NAMED_RANGES,
  analyzeFormulas,
  generateFormulaDocumentation,
  getStyleHints,
} from '../../internal/format-utils';
import {
  buildAboveContext,
  buildLeftContext,
  getAboveContextBounds,
  getLeftContextBounds,
} from '../../internal/range-context';
import { analyzeStylePatterns } from '../../internal/style-patterns';
import { parseCellRange, toA1 } from '../../internal/utils';
import { normalizeCellValue, cellValueToString } from '../../internal/value-conversions';

import * as CellOps from './cell-operations';
import * as QueryOps from './query-operations';

/**
 * When describe() is called with no arguments, sheets larger than this
 * bounding-box threshold delegate to summarize({ includeData: true })
 * instead of describeRange(). This keeps LLM context manageable
 * (~200 cells ≈ 10 rows × 20 cols) while still returning data.
 */
const MAX_DESCRIBE_AUTO_CELLS = 200;

// =============================================================================
// describe — single cell or whole used range
// =============================================================================

/**
 * Build a compact string representation of a single cell, or describe the
 * entire used range when no address is provided.
 *
 * With address: returns `rawValue(=formula) [styleHints]`
 * Without address: delegates to describeRange() over the used range
 *
 * @param ctx - Document context
 * @param sheetId - Sheet ID
 * @param address - Cell address (e.g. "A1"), or undefined for the whole used range
 * @returns Formatted string, or empty string if cell/sheet is empty
 */
export async function describe(
  ctx: DocumentContext,
  sheetId: SheetId,
  address?: string,
): Promise<string> {
  // No address (or empty string) → describe the entire used range (or summarize if too large)
  if (address === undefined || address === '') {
    return describeUsedRange(ctx, sheetId);
  }

  // Range string → delegate to describeRange
  if (address.includes(':')) {
    return describeRange(ctx, sheetId, address);
  }

  const { row, col } = resolveCell(address);
  const data = await CellOps.getCell(ctx, sheetId, row, col);
  if (!data) return '';

  // Use raw value so agents can reason about precise numbers; format metadata is in style hints
  const rawValue = cellValueToString(data.value);

  // Build output — start with raw value
  let result = rawValue;

  // Add formula inline if present: "value(=formula)"
  if (data.formula) {
    result = rawValue !== '' ? `${rawValue}(${data.formula})` : `(${data.formula})`;
  }

  // Add style hints for notable formatting
  const styleHintsStr = await getStyleHints(ctx, sheetId, row, col);
  if (styleHintsStr) {
    result = `${result} [${styleHintsStr}]`;
  }

  return result;
}

export async function describeUsedRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  includeStyle: boolean = true,
): Promise<string> {
  const usedRange = await QueryOps.getUsedRange(ctx, sheetId);
  if (!usedRange) return '';

  const rows = usedRange.endRow - usedRange.startRow + 1;
  const cols = usedRange.endCol - usedRange.startCol + 1;
  const boundingBox = rows * cols;

  if (boundingBox >= MAX_DESCRIBE_AUTO_CELLS) {
    return summarize(ctx, sheetId, { includeData: true });
  }

  const rangeStr = `${toA1(usedRange.startRow, usedRange.startCol)}:${toA1(usedRange.endRow, usedRange.endCol)}`;
  return describeRange(ctx, sheetId, rangeStr, includeStyle);
}

// =============================================================================
// describeRange — multi-cell range
// =============================================================================

/**
 * Format a single range's describe output from pre-fetched data.
 * Shared by ws.describeRange() and wb.describeRanges().
 *
 * Handles: cell formatting, formula analysis, style patterns, left/above context fetching.
 */
export async function formatDescribeRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  rangeData: RangeQueryResult,
  parsed: { startRow: number; startCol: number; endRow: number; endCol: number },
  includeStyle: boolean = true,
): Promise<string> {
  // Build lookup map from flat cell array
  const cellMap = new Map<string, RangeCellData>();
  for (const vc of rangeData.cells) {
    cellMap.set(`${vc.row},${vc.col}`, vc);
  }

  // First pass: collect all cells with formulas for pattern analysis
  const formulaCells: Array<{ row: number; col: number; formula: string; value: unknown }> = [];

  for (let row = parsed.startRow; row <= parsed.endRow; row++) {
    for (let col = parsed.startCol; col <= parsed.endCol; col++) {
      const vc = cellMap.get(`${row},${col}`);
      if (vc?.formula) {
        formulaCells.push({
          row,
          col,
          formula: vc.formula,
          value: normalizeCellValue(vc.value),
        });
      }
    }
  }

  // Analyze formulas
  const formulaAnalysis = analyzeFormulas(formulaCells);
  const hasAbbreviations = Array.from(formulaAnalysis.patterns.values()).some(
    (p) => p.cells.length >= formulaAnalysis.minCellsForAbbreviation,
  );

  const outputParts: string[] = [];

  // 1. Optional formula alias explanation (matches COM format)
  if (hasAbbreviations) {
    outputParts.push(
      'Common formulas are abbreviated like F1, F2, etc. and the definitions are below',
    );
    outputParts.push('');
  }

  // 2. Main data lines: A1:value(formula) | B1:value
  for (let row = parsed.startRow; row <= parsed.endRow; row++) {
    const rowValues: string[] = [];

    for (let col = parsed.startCol; col <= parsed.endCol; col++) {
      const cellAddr = toA1(row, col);
      const vc = cellMap.get(`${row},${col}`);

      if (!vc) {
        rowValues.push(`${cellAddr}:`);
        continue;
      }

      // Use raw value so agents can reason about precise numbers; format metadata is in style hints
      const rawValue = cellValueToString(vc.value);
      let cellStr = rawValue;

      // Add formula (abbreviated or full) — COM strips leading '=' on alias
      if (vc.formula) {
        const abbreviation = formulaAnalysis.formulaToId.get(`${row},${col}`);
        if (abbreviation) {
          cellStr = `${cellStr}(${abbreviation})`;
        } else {
          cellStr = `${cellStr}(${vc.formula})`;
        }
      }

      rowValues.push(`${cellAddr}:${cellStr}`);
    }

    outputParts.push(rowValues.join(' | '));
  }

  // 3. Formula definitions
  const formulaDocs = generateFormulaDocumentation(formulaAnalysis);
  if (formulaDocs.length > 0) {
    outputParts.push(...formulaDocs);
  }

  // 4. Style patterns section
  if (includeStyle) {
    const styleCells = rangeData.cells.map((vc) => ({
      row: vc.row,
      col: vc.col,
      value: normalizeCellValue(vc.value),
      format: vc.format as CellFormat | undefined,
    }));
    const styleLines = analyzeStylePatterns(styleCells);
    if (styleLines.length > 0) {
      outputParts.push('');
      outputParts.push('--- Style patterns ---');
      outputParts.push(...styleLines);
    }
  }

  // 5. Context from cells to the left
  const leftBounds = getLeftContextBounds(parsed.startRow, parsed.startCol, parsed.endRow);
  if (leftBounds) {
    const leftRange = await ctx.computeBridge.queryRange(
      sheetId,
      leftBounds.startRow,
      leftBounds.startCol,
      leftBounds.endRow,
      leftBounds.endCol,
    );
    const leftCellData = leftRange.cells.map((vc) => ({
      row: vc.row,
      col: vc.col,
      value: normalizeCellValue(vc.value),
      formatted: vc.formatted ?? undefined,
      indent: 0, // indent not available from queryRange; would need format.indent
    }));
    const leftLines = buildLeftContext(
      leftCellData,
      parsed.startRow,
      parsed.startCol,
      parsed.endRow,
    );
    if (leftLines && leftLines.length > 0) {
      outputParts.push('');
      outputParts.push('--- Context from cells to the left ---');
      outputParts.push(...leftLines);
    }
  }

  // 6. Context from cells above (header row voting)
  const aboveBounds = getAboveContextBounds(parsed.startRow, parsed.startCol, parsed.endCol);
  if (aboveBounds) {
    const aboveRange = await ctx.computeBridge.queryRange(
      sheetId,
      aboveBounds.startRow,
      aboveBounds.startCol,
      aboveBounds.endRow,
      aboveBounds.endCol,
    );
    const aboveCellData = aboveRange.cells.map((vc) => ({
      row: vc.row,
      col: vc.col,
      value: normalizeCellValue(vc.value),
      formatted: vc.formatted ?? undefined,
    }));
    const aboveLine = buildAboveContext(
      aboveCellData,
      parsed.startRow,
      parsed.startCol,
      parsed.endCol,
    );
    if (aboveLine) {
      outputParts.push('');
      outputParts.push('--- Context from cells above ---');
      outputParts.push(aboveLine);
    }
  }

  const output = outputParts.join('\n');

  // Output-size safety valve: truncate if formatted output exceeds ~50KB
  if (output.length > MAX_DESCRIBE_OUTPUT_CHARS) {
    return output.slice(0, MAX_DESCRIBE_OUTPUT_CHARS) + '\n... (truncated, use a smaller range)';
  }

  return output;
}

/**
 * Build a formatted multi-cell range description with formula analysis,
 * style patterns, and surrounding context.
 *
 * @param ctx - Document context
 * @param sheetId - Sheet ID
 * @param range - Range string (e.g. "A1:C10")
 * @param includeStyle - Whether to include style pattern analysis (default true)
 * @returns Formatted string
 */
export async function describeRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: string,
  includeStyle: boolean = true,
): Promise<string> {
  const parsed = parseCellRange(range);
  if (!parsed) return '';

  const rows = parsed.endRow - parsed.startRow + 1;
  const cols = parsed.endCol - parsed.startCol + 1;
  const boundingBoxSize = rows * cols;

  // Hard cap on bounding box to prevent absurdly large IPC calls
  if (boundingBoxSize > MAX_RANGE_BOUNDING_BOX) {
    return `Range ${range} has ${boundingBoxSize} cells in its bounding box; limit is ${MAX_RANGE_BOUNDING_BOX}. Use a smaller range.`;
  }

  // Single IPC call to get all cells in the range
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    parsed.startRow,
    parsed.startCol,
    parsed.endRow,
    parsed.endCol,
  );

  // Guard on actual non-empty cells (not bounding box area)
  const nonEmptyCells = rangeData.cells.length;
  if (nonEmptyCells > MAX_RANGE_CELLS) {
    return `Range ${range} has ${nonEmptyCells} non-empty cells; limit is ${MAX_RANGE_CELLS}. Use a smaller range or summarize() for an overview.`;
  }

  return formatDescribeRange(ctx, sheetId, rangeData, parsed, includeStyle);
}

// =============================================================================
// summarize — sheet overview
// =============================================================================

/**
 * Build a sheet overview with metadata, charts, tables, named ranges,
 * content breakdown, and sample data rows.
 *
 * @param ctx - Document context
 * @param sheetId - Sheet ID
 * @param options - Optional summary configuration (maxRows, maxCols, includeData)
 * @returns Formatted string
 */
export async function summarize(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: SummaryOptions,
): Promise<string> {
  const meta = await getMeta(ctx, sheetId);
  if (!meta) return `Sheet not found: ${sheetId}`;

  const lines: string[] = [];
  lines.push(`Sheet: ${meta.name}`);

  // Get data bounds from Rust compute-core (O(1) lookup)
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);

  if (bounds) {
    const startAddr = toA1(bounds.minRow, bounds.minCol);
    const endAddr = toA1(bounds.maxRow, bounds.maxCol);
    lines.push(`Used Range: ${startAddr}:${endAddr}`);
    lines.push(
      `Dimensions: ${bounds.maxRow - bounds.minRow + 1} rows x ${bounds.maxCol - bounds.minCol + 1} columns`,
    );
  } else {
    lines.push('Used Range: (empty)');
    lines.push('Dimensions: 0 rows x 0 columns');
  }

  // Frozen panes
  if (meta.frozenRows > 0 || meta.frozenCols > 0) {
    lines.push(`Frozen: ${meta.frozenRows} rows, ${meta.frozenCols} columns`);
  }

  // Charts
  const charts = await getAllCharts(ctx, sheetId);
  if (charts.length > 0) {
    const chartNames = charts.map((c) => c.id).join(', ');
    lines.push(`Charts: ${charts.length} (${chartNames})`);
  }

  // Tables
  const tables = await TablesCore.getTablesInSheet(ctx, sheetId);
  if (tables.length > 0) {
    const tableDescs = tables.map((t) => {
      const r = `${toA1(t.range.startRow, t.range.startCol)}:${toA1(t.range.endRow, t.range.endCol)}`;
      return `${t.name} at ${r}`;
    });
    lines.push(`Tables: ${tables.length} (${tableDescs.join(', ')})`);
  }

  // Named ranges — filter hidden (Rust-side), skip #REF!, cap display
  const allVisible = await NamedRanges.getVisible(ctx);
  const scoped = allVisible.filter((nr) => nr.scope === sheetId || !nr.scope);
  const valid = scoped.filter((nr) => !nr.refersTo.template.includes('#REF!'));
  const broken = scoped.length - valid.length;

  if (valid.length > 0 || broken > 0) {
    const toShow = valid.slice(0, MAX_SUMMARY_NAMED_RANGES);
    const nrDescs: string[] = [];
    for (const nr of toShow) {
      const a1 = await NamedRanges.getRefersToA1(ctx, nr);
      nrDescs.push(`${nr.name}=${a1}`);
    }

    let label = `Named Ranges: ${valid.length}`;
    if (broken > 0) label += ` valid, ${broken} broken (#REF!) omitted`;

    if (nrDescs.length > 0) {
      const showing =
        valid.length > MAX_SUMMARY_NAMED_RANGES ? `showing ${MAX_SUMMARY_NAMED_RANGES}: ` : '';
      const more =
        valid.length > MAX_SUMMARY_NAMED_RANGES
          ? ` — ${valid.length - MAX_SUMMARY_NAMED_RANGES} more not shown`
          : '';
      lines.push(`${label} (${showing}${nrDescs.join(', ')})${more}`);
    } else {
      lines.push(label);
    }
  }

  // Resolve maxRows/maxCols options
  const maxRows = options?.maxRows;
  const maxCols = options?.maxCols;
  // Three states: undefined → show 5 sample rows, true → show all data, false → no data
  const includeData = options?.includeData;

  // Display range may be narrowed by maxRows/maxCols
  const displayRange = bounds
    ? {
        startRow: bounds.minRow,
        startCol: bounds.minCol,
        endRow:
          maxRows != null ? Math.min(bounds.minRow + maxRows - 1, bounds.maxRow) : bounds.maxRow,
        endCol:
          maxCols != null ? Math.min(bounds.minCol + maxCols - 1, bounds.maxCol) : bounds.maxCol,
      }
    : null;

  // Default enrichment: headers, content breakdown, sample rows
  if (displayRange) {
    // Always query FULL bounds for content stats (not the display-truncated range)
    const fullRangeData = await ctx.computeBridge.queryRange(
      sheetId,
      bounds!.minRow,
      bounds!.minCol,
      bounds!.maxRow,
      bounds!.maxCol,
    );

    // Build row-indexed structure from the full data
    const rowMap = new Map<number, RangeCellData[]>();
    for (const vc of fullRangeData.cells) {
      let row = rowMap.get(vc.row);
      if (!row) {
        row = [];
        rowMap.set(vc.row, row);
      }
      row.push(vc);
    }

    // --- Header detection (filtered to displayRange columns) ---
    const firstRowCells = (rowMap.get(displayRange.startRow) ?? [])
      .filter((vc) => vc.col >= displayRange.startCol && vc.col <= displayRange.endCol)
      .slice()
      .sort((a, b) => a.col - b.col);
    if (firstRowCells.length > 0) {
      const allStrings = firstRowCells.every((vc) => typeof vc.value === 'string' && !vc.formula);
      if (allStrings) {
        const headers = firstRowCells.map((vc) => String(vc.value));
        lines.push(`Headers: ${headers.join(', ')}`);
      }
    }

    // --- Content breakdown (always over full sheet, not truncated window) ---
    let numberCount = 0;
    let stringCount = 0;
    let formulaCount = 0;
    let booleanCount = 0;
    let errorCount = 0;

    for (const vc of fullRangeData.cells) {
      if (vc.formula) formulaCount++;
      const v = vc.value;
      if (typeof v === 'number') numberCount++;
      else if (typeof v === 'string') stringCount++;
      else if (typeof v === 'boolean') booleanCount++;
      else if (v !== null && v !== undefined && isCellError(v)) errorCount++;
    }

    const totalValues = fullRangeData.cells.length;
    const parts: string[] = [];
    if (numberCount > 0) parts.push(`${numberCount} numbers`);
    if (stringCount > 0) parts.push(`${stringCount} strings`);
    if (booleanCount > 0) parts.push(`${booleanCount} booleans`);
    if (errorCount > 0) parts.push(`${errorCount} errors`);
    if (formulaCount > 0) parts.push(`${formulaCount} formulas`);
    lines.push(`Content: ${totalValues} values (${parts.join(', ')})`);

    // --- Data section ---
    // includeData === false → no data at all
    // includeData === undefined (default) → 5 sample rows
    // includeData === true → all data rows (capped at 100 to prevent 1MB dumps)
    if (includeData !== false) {
      const maxDataRows = 100;
      const sampleStartRow = displayRange.startRow;
      const defaultSampleRows = 5;
      const sampleEndRow =
        includeData === true
          ? Math.min(displayRange.endRow, displayRange.startRow + maxDataRows - 1)
          : Math.min(displayRange.startRow + defaultSampleRows - 1, displayRange.endRow);

      lines.push('');
      lines.push(includeData === true ? '--- Cell Data ---' : '--- Sample Data ---');

      for (let row = sampleStartRow; row <= sampleEndRow; row++) {
        const cells = (rowMap.get(row) ?? [])
          .filter((vc) => vc.col >= displayRange.startCol && vc.col <= displayRange.endCol)
          .slice()
          .sort((a, b) => a.col - b.col);
        const rowData: string[] = [];
        for (const vc of cells) {
          const rawValue = cellValueToString(vc.value);
          const addr = toA1(vc.row, vc.col);
          if (vc.formula) {
            rowData.push(`${addr}:${rawValue}(${vc.formula})`);
          } else {
            rowData.push(`${addr}:${rawValue}`);
          }
        }
        if (rowData.length > 0) {
          lines.push(rowData.join(' | '));
        }
      }

      if (sampleEndRow < displayRange.endRow) {
        const remaining = displayRange.endRow - sampleEndRow;
        lines.push(
          includeData === true
            ? `... (${remaining} more rows, capped at ${maxDataRows})`
            : `... (${remaining} more rows, use describeRange for full data)`,
        );
      }
    }
  }

  return lines.join('\n');
}
