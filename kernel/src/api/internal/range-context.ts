/**
 * Range Context — left and above context extraction for LLM-optimized range output.
 *
 * Left context: for each row in a range, scans leftward for textual row labels.
 * Above context: uses voting to find the best header row above the range,
 * then builds a pipe-separated chain of column headers.
 *
 * All functions are pure — they operate on pre-fetched cell data arrays
 * and have no dependency on ComputeBridge or DocumentContext.
 */

import type { CellValue } from '@mog-sdk/contracts/core';

import { colToLetter } from './utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max columns to scan leftward when collecting row labels */
const CONTEXT_ROW_SEARCH_DEPTH = 20;

/** Max rows to scan upward when collecting header context */
const CONTEXT_COLUMN_SEARCH_DEPTH = 20;

/** Max textual cells to include per row in left context */
const MAX_LEFT_CONTEXT_COLUMNS = 2;

/** Percentage of rightmost columns used for header row voting */
const HEADER_ROW_VOTING_PERCENT = 30;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A cell with enough data for context scanning. */
export interface ContextCellData {
  row: number;
  col: number;
  value: CellValue;
  formatted: string | undefined;
  indent?: number;
}

/**
 * Check if a value is numerical (number type or numeric string).
 * Integers, decimals, numbers with commas, scientific notation.
 */
function isNumerical(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    return /^-?\d[\d,]*(\.\d+)?([eE][+-]?\d+)?$/.test(value);
  }
  return false;
}

/** Resolve a ContextCellData to its display string. */
function displayOf(cell: ContextCellData): string {
  return cell.formatted ?? (cell.value != null ? String(cell.value) : '');
}

// ---------------------------------------------------------------------------
// Left Context
// ---------------------------------------------------------------------------

/**
 * Build left context lines from pre-fetched cell data.
 *
 * For each row in the range, scans leftward for up to MAX_LEFT_CONTEXT_COLUMNS
 * textual (non-numeric) cells and renders them as "ADDR:text" tokens.
 *
 * @param leftCells - Flat array of cells to the left of the range
 * @param startRow - Top row of the original range (0-based)
 * @param startCol - Left column of the original range (0-based)
 * @param endRow - Bottom row of the original range (0-based)
 * @returns Array of lines, or null if no context found.
 */
export function buildLeftContext(
  leftCells: ContextCellData[],
  startRow: number,
  startCol: number,
  endRow: number,
): string[] | null {
  if (startCol === 0) return null;

  const rows = endRow - startRow + 1;

  // Build lookup: row -> cells sorted by col descending (rightward-first scan)
  const rowMap = new Map<number, ContextCellData[]>();
  for (const cell of leftCells) {
    if (!rowMap.has(cell.row)) rowMap.set(cell.row, []);
    rowMap.get(cell.row)!.push(cell);
  }
  for (const cells of rowMap.values()) {
    cells.sort((a, b) => b.col - a.col);
  }

  const lines: string[] = [];
  let anyFound = false;

  for (let r = 0; r < rows; r++) {
    const row = startRow + r;
    const rowCells = rowMap.get(row) || [];
    const found: Array<{ col: number; text: string; indent: number }> = [];
    let collected = 0;

    for (const cell of rowCells) {
      const display = displayOf(cell);
      if (!display.trim()) continue;
      if (isNumerical(display)) continue;

      found.push({ col: cell.col, text: display, indent: cell.indent ?? 0 });
      collected++;
      if (collected >= MAX_LEFT_CONTEXT_COLUMNS) break;
    }

    if (found.length === 0) {
      lines.push('');
      continue;
    }

    anyFound = true;
    found.sort((a, b) => a.col - b.col);
    const tokens = found.map((f) => {
      const prefix = '\u2192'.repeat(Math.max(0, f.indent));
      const addr = `${colToLetter(f.col)}${row + 1}`;
      return `${prefix}${addr}:${f.text}`;
    });
    lines.push(tokens.join(' | '));
  }

  return anyFound ? lines : null;
}

/**
 * Compute the queryRange bounds needed for left context.
 * @returns Bounds or null if startCol is 0.
 */
export function getLeftContextBounds(
  startRow: number,
  startCol: number,
  endRow: number,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (startCol === 0) return null;
  const leftBound = Math.max(0, startCol - CONTEXT_ROW_SEARCH_DEPTH);
  if (leftBound >= startCol) return null;
  return { startRow, startCol: leftBound, endRow, endCol: startCol - 1 };
}

// ---------------------------------------------------------------------------
// Above Context (Header Row Voting)
// ---------------------------------------------------------------------------

/**
 * Build above context (header chain) from pre-fetched cell data.
 *
 * Uses voting from the rightmost columns to pick the best header row,
 * then builds a pipe-separated chain of textual headers with "..." for
 * numeric gaps.
 *
 * @param aboveCells - Flat array of cells above the range
 * @param startRow - Top row of the original range (0-based)
 * @param startCol - Left column of the original range (0-based)
 * @param endCol - Right column of the original range (0-based)
 * @returns Single header chain string, or null if no header found.
 */
export function buildAboveContext(
  aboveCells: ContextCellData[],
  startRow: number,
  startCol: number,
  endCol: number,
): string | null {
  if (startRow === 0) return null;

  const cellMap = new Map<string, ContextCellData>();
  for (const cell of aboveCells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  const totalCols = endCol - startCol + 1;
  const numVotingCols = Math.max(1, Math.round((HEADER_ROW_VOTING_PERCENT / 100) * totalCols));
  const votingStart = Math.max(startCol, endCol - numVotingCols + 1);

  // Step 1: vote
  const votes = new Map<number, number>();
  for (let c = endCol; c >= votingStart; c--) {
    let scanned = 0;
    for (let r = startRow - 1; r >= 0; r--) {
      scanned++;
      if (scanned > CONTEXT_COLUMN_SEARCH_DEPTH) break;
      const cell = cellMap.get(`${r},${c}`);
      if (!cell) continue;
      const d = displayOf(cell);
      if (!d.trim()) continue;
      if (isNumerical(d)) continue;
      votes.set(r, (votes.get(r) || 0) + 1);
      break;
    }
  }

  if (votes.size === 0) return null;

  // Step 2: pick winner (tie-break by textual density)
  const countTextual = (r: number): number => {
    let total = 0;
    for (let c = startCol; c <= endCol; c++) {
      const cell = cellMap.get(`${r},${c}`);
      if (!cell) continue;
      const d = displayOf(cell);
      if (!d.trim()) continue;
      if (isNumerical(d)) continue;
      total++;
    }
    return total;
  };

  let bestRow = -1;
  let bestVotes = -1;
  for (const [row, count] of votes.entries()) {
    if (count > bestVotes) {
      bestVotes = count;
      bestRow = row;
    } else if (count === bestVotes && countTextual(row) > countTextual(bestRow)) {
      bestRow = row;
    }
  }

  if (bestRow < 0) return null;

  // Step 3: build horizontal chain
  const tokens: string[] = [];
  let sawNumeric = false;
  for (let c = startCol; c <= endCol; c++) {
    const cell = cellMap.get(`${bestRow},${c}`);
    if (!cell) continue;
    const d = displayOf(cell);
    if (!d.trim()) continue;
    if (isNumerical(d)) {
      sawNumeric = true;
      continue;
    }
    const addr = `${colToLetter(c)}${bestRow + 1}`;
    if (tokens.length > 0 && sawNumeric) tokens.push('...');
    tokens.push(`${addr}:${d}`);
    sawNumeric = false;
  }

  return tokens.length > 0 ? tokens.join(' | ') : null;
}

/**
 * Compute the queryRange bounds needed for above context.
 * @returns Bounds or null if startRow is 0.
 */
export function getAboveContextBounds(
  startRow: number,
  startCol: number,
  endCol: number,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (startRow === 0) return null;
  const topBound = Math.max(0, startRow - CONTEXT_COLUMN_SEARCH_DEPTH);
  return { startRow: topBound, startCol, endRow: startRow - 1, endCol };
}
