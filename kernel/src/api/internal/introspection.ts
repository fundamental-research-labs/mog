/**
 * Introspection Module
 *
 * Provides snapshot and catalog functions for the SpreadsheetAPI.
 * These functions allow consumers to understand the current state
 * of the workbook and available functions.
 *
 * Stability:
 * - getFunctionCatalog / getFunctionInfo: @stability stable — pure catalog queries
 * - getWorkbookSnapshot: @stability experimental — takes IKernelContext, shape may evolve
 *
 * ARCHITECTURE:
 * - Uses DocumentContext for dependency injection
 * - Reads via domain modules (Cells, Sheets, Charts)
 *
 */

import type { FunctionInfo, SheetSnapshot, WorkbookSnapshot } from '@mog-sdk/contracts/api';
import type { FunctionArgument } from '@mog-sdk/contracts/utils';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { globalRegistry } from '@mog/spreadsheet-utils/function-registry';
import { ensureFunctionCatalog } from '@mog/spreadsheet-utils/function-catalog';
import * as Charts from '../../domain/charts';
import { getFirstId, getMeta, getOrder } from '../../domain/sheets/sheet-meta';

import type { DocumentContext } from '../../context';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

// ============================================================================
// Workbook Snapshot
// ============================================================================

/**
 * Get a snapshot of the entire workbook state.
 *
 * Provides high-level information about all sheets including:
 * - Sheet names and IDs
 * - Used ranges (cells with data)
 * - Cell and formula counts
 * - Chart counts
 *
 * @param ctx - The IKernelContext (cast internally to DocumentContext)
 * @param getActiveSheetId - Optional function to get active sheet ID
 * @returns WorkbookSnapshot with all sheet information
 */
export async function getWorkbookSnapshot(
  ctx: IKernelContext,
  getActiveSheetId?: () => string,
): Promise<WorkbookSnapshot> {
  const dctx = ctx as DocumentContext;
  const sheetIds = await getOrder(dctx);

  const sheets = await Promise.all(sheetIds.map((id, index) => getSheetSnapshot(dctx, id, index)));

  const activeSheetId = getActiveSheetId ? getActiveSheetId() : await getFirstId(dctx);

  return {
    sheets,
    activeSheetId,
    sheetCount: sheetIds.length,
  };
}

/**
 * Get a snapshot of a single sheet.
 *
 * @param ctx - The DocumentContext
 * @param sheetId - The sheet ID
 * @param index - The sheet index in the workbook
 * @returns SheetSnapshot with sheet information
 */
async function getSheetSnapshot(
  ctx: DocumentContext,
  sheetId: SheetId,
  index: number,
): Promise<SheetSnapshot> {
  const meta = await getMeta(ctx, sheetId);
  const stats = await calculateSheetStats(ctx, sheetId);
  const charts = await Charts.getAll(ctx, sheetId);

  return {
    id: sheetId,
    name: meta?.name ?? 'Sheet',
    index,
    usedRange: stats.usedRange,
    cellCount: stats.cellCount,
    formulaCount: stats.formulaCount,
    chartCount: charts.length,
    dimensions: {
      rows: 1000, // Default virtual grid size
      cols: 26, // A-Z by default
    },
  };
}

/**
 * Calculate statistics for a sheet by iterating over all cells.
 */
async function calculateSheetStats(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<{
  cellCount: number;
  formulaCount: number;
  usedRange: CellRange | null;
}> {
  // Use getDataBounds (O(1) Rust query) instead of brute-force iteration
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);

  if (!bounds) {
    return { cellCount: 0, formulaCount: 0, usedRange: null };
  }

  // Use queryRange to get actual cell data within the bounded range
  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  let formulaCount = 0;
  for (const cell of rangeResult.cells) {
    if (cell.formula) {
      formulaCount++;
    }
  }

  return {
    cellCount: rangeResult.cells.length,
    formulaCount,
    usedRange: {
      sheetId,
      startRow: bounds.minRow,
      startCol: bounds.minCol,
      endRow: bounds.maxRow,
      endCol: bounds.maxCol,
    },
  };
}

// ============================================================================
// Function Catalog
// ============================================================================

/**
 * Get all available spreadsheet functions.
 *
 * Returns metadata for all registered Excel-compatible functions
 * from the calculator engine.
 *
 * @returns Array of FunctionInfo objects
 */
export function getFunctionCatalog(): FunctionInfo[] {
  ensureFunctionCatalog();
  const names = globalRegistry.getAllNames();

  return names
    .map((name) => {
      const metadata = globalRegistry.getMetadata(name);
      if (!metadata) return null;

      return convertToFunctionInfo(metadata);
    })
    .filter((info): info is FunctionInfo => info !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get detailed info about a specific function.
 *
 * @param name - Function name (case-insensitive)
 * @returns FunctionInfo, or undefined if not found
 */
export function getFunctionInfo(name: string): FunctionInfo | undefined {
  ensureFunctionCatalog();
  const metadata = globalRegistry.getMetadata(name);
  if (!metadata) return undefined;

  return convertToFunctionInfo(metadata);
}

/**
 * Convert internal FunctionMetadata to external FunctionInfo.
 */
function convertToFunctionInfo(metadata: {
  name: string;
  category: string;
  description: string;
  minArgs?: number;
  maxArgs?: number;
  arguments?: FunctionArgument[];
}): FunctionInfo {
  const minArgs = metadata.minArgs ?? 0;
  const maxArgs = metadata.maxArgs ?? minArgs;

  // Prefer concrete argument metadata when the registry provides it; fall back
  // to synthesizing generic placeholders from min/max arity.
  const args: FunctionArgument[] =
    metadata.arguments ??
    (() => {
      const synthesized: FunctionArgument[] = [];
      const upper = Math.max(minArgs, maxArgs === Infinity ? minArgs + 1 : maxArgs);
      for (let i = 0; i < upper; i++) {
        const isOptional = i >= minArgs;
        const isRepeating = maxArgs === Infinity && i >= minArgs;
        synthesized.push({
          name: `arg${i + 1}`,
          description: isRepeating ? 'Additional values (can repeat)' : `Argument ${i + 1}`,
          type: 'any',
          optional: isOptional,
          repeating: isRepeating,
        });
        if (isRepeating) break;
      }
      return synthesized;
    })();

  // Generate syntax string
  let syntax = `${metadata.name}(`;
  if (args.length > 0) {
    const parts = args.flatMap((arg) => {
      const label = arg.optional ? `[${arg.name}]` : arg.name;
      return arg.repeating ? [label, '...'] : [label];
    });
    syntax += parts.join(', ') + ')';
  } else if (minArgs === 0 && maxArgs === 0) {
    syntax += ')';
  } else if (maxArgs === Infinity) {
    syntax += `value1, [value2], ...)`;
  } else {
    const parts: string[] = [];
    for (let i = 0; i < maxArgs; i++) {
      const isOptional = i >= minArgs;
      parts.push(isOptional ? `[arg${i + 1}]` : `arg${i + 1}`);
    }
    syntax += parts.join(', ') + ')';
  }

  return {
    name: metadata.name,
    category: String(metadata.category),
    description: metadata.description,
    syntax,
    arguments: args,
  };
}
