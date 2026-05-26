/**
 * Style Pattern Analysis — groups cells by formatting for LLM-optimized range output.
 *
 * Groups non-empty cells by their style key, then generates a compact
 * "--- Style patterns ---" section showing range consolidation, cell counts,
 * and style descriptions.
 *
 * Pure function — operates on pre-fetched cell data, no IPC.
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';

import { buildStyleHintsFromFormat } from './format-utils';
import { colToLetter } from './utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STYLE_ENTRIES = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cell data needed for style analysis. */
export interface StyleCell {
  row: number;
  col: number;
  value: CellValue;
  format: CellFormat | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable key from a CellFormat for grouping identical styles. */
function getStyleKey(format: CellFormat | undefined): string {
  if (!format || typeof format !== 'object') return '';
  const sortedKeys = Object.keys(format).sort();
  const parts: string[] = [];
  for (const key of sortedKeys) {
    const value = (format as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(typeof value === 'object' ? `${key}:${JSON.stringify(value)}` : `${key}:${value}`);
    }
  }
  return parts.join('|');
}

/** Human-readable style description via buildStyleHintsFromFormat. */
function getStyleDescription(format: CellFormat | undefined): string {
  if (!format) return 'No style';
  const hints = buildStyleHintsFromFormat(format);
  return hints.length > 0 ? hints.join(', ') : 'Default style';
}

/**
 * Consolidate cell coordinates into compact rectangular range strings.
 * e.g. [(0,0),(0,1),(0,2),(1,0),(1,1),(1,2)] -> ["A1:C2"]
 */
function consolidateRanges(cells: Array<{ row: number; col: number }>): string[] {
  if (cells.length === 0) return [];

  const cellSet = new Set(cells.map((c) => `${c.row},${c.col}`));
  const covered = new Set<string>();
  const ranges: string[] = [];
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);

  for (const cell of sorted) {
    const key = `${cell.row},${cell.col}`;
    if (covered.has(key)) continue;

    // Expand rightward
    let endCol = cell.col;
    while (cellSet.has(`${cell.row},${endCol + 1}`) && !covered.has(`${cell.row},${endCol + 1}`)) {
      endCol++;
    }

    // Expand downward
    let endRow = cell.row;
    outer: while (true) {
      for (let c = cell.col; c <= endCol; c++) {
        if (!cellSet.has(`${endRow + 1},${c}`) || covered.has(`${endRow + 1},${c}`)) break outer;
      }
      endRow++;
    }

    for (let r = cell.row; r <= endRow; r++) {
      for (let c = cell.col; c <= endCol; c++) {
        covered.add(`${r},${c}`);
      }
    }

    const start = `${colToLetter(cell.col)}${cell.row + 1}`;
    const end = `${colToLetter(endCol)}${endRow + 1}`;
    ranges.push(start === end ? start : `${start}:${end}`);
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze style patterns in a range and generate documentation lines.
 *
 * @param cells - Flat array of cells with format data
 * @returns Lines for the "--- Style patterns ---" section, or empty array.
 */
export function analyzeStylePatterns(cells: StyleCell[]): string[] {
  const styleMap = new Map<
    string,
    {
      cells: Array<{ row: number; col: number; value: CellValue }>;
      description: string;
    }
  >();

  for (const cell of cells) {
    if (cell.value === null && !cell.format) continue;
    const key = getStyleKey(cell.format);
    if (!key) continue;

    if (!styleMap.has(key)) {
      styleMap.set(key, { cells: [], description: getStyleDescription(cell.format) });
    }
    styleMap.get(key)!.cells.push({ row: cell.row, col: cell.col, value: cell.value });
  }

  if (styleMap.size === 0) return [];

  const lines: string[] = [];
  const entries = Array.from(styleMap.values()).slice(0, MAX_STYLE_ENTRIES);

  for (const info of entries) {
    if (info.description === 'Default style' || info.description === 'No style') continue;
    const rangeStr = consolidateRanges(info.cells).join(', ');
    const count = info.cells.length;

    lines.push(`${rangeStr}: ${count} cells`);
    lines.push(`  \u2192 ${info.description}`);
  }

  if (styleMap.size > MAX_STYLE_ENTRIES) {
    lines.push('');
    lines.push(`... and ${styleMap.size - MAX_STYLE_ENTRIES} more style patterns`);
  }

  return lines;
}
