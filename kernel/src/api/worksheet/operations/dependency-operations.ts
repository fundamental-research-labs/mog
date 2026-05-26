/**
 * Dependency Operations Module
 *
 * Cell dependency analysis (dependents and precedents) via Rust compute-core's
 * dependency graph. The graph tracks all formula references and is maintained
 * automatically during recalculation.
 */

import { toA1, toSheetA1 } from '@mog/spreadsheet-utils/a1';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from './shared';

/**
 * Get cells that depend on the specified cell.
 *
 * Queries the Rust dependency graph for all formula cells that reference
 * the given cell position. Cross-sheet dependents are returned with
 * sheet name prefixes (e.g., "Sheet2!B3").
 */
export async function getDependents(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string[]> {
  const results = await ctx.computeBridge.getDependents(sheetId, row, col);
  return results.map((r) =>
    r.sheetId === sheetId ? toA1(r.row, r.col) : toSheetA1(r.row, r.col, r.sheetName),
  );
}

/**
 * Get cells that the specified cell references (precedents).
 *
 * Queries the Rust dependency graph for all cells that the given cell's
 * formula depends on. Cross-sheet precedents are returned with
 * sheet name prefixes (e.g., "'Data Sheet'!A1").
 */
export async function getPrecedents(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string[]> {
  const results = await ctx.computeBridge.getPrecedents(sheetId, row, col);
  return results.map((r) =>
    r.sheetId === sheetId ? toA1(r.row, r.col) : toSheetA1(r.row, r.col, r.sheetName),
  );
}
