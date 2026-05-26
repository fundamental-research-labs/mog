/**
 * Goal Seek Operations Module
 *
 * Standalone functions for Goal Seek (what-if) analysis.
 *
 * RESPONSIBILITIES:
 * - goalSeek: Find the input value that makes a formula cell reach a target value
 *
 * ARCHITECTURE:
 * - Takes (ctx: DocumentContext, sheetId: string) as first two params
 * - Resolves A1 addresses to CellIds, calls ComputeBridge.goalSeek()
 * - Returns contract GoalSeekResult
 */

import type { GoalSeekResult } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../../errors';
import type { DocumentContext } from '../../../context';
import { resolveCell } from '../../internal/address-resolver';
import * as CellOps from './cell-operations';

/**
 * Find the input value that makes a formula cell reach a target value.
 *
 * Resolves A1 references, retrieves CellIds, runs the Goal Seek algorithm
 * via the compute bridge, and applies the solution to the changing cell
 * if one is found.
 */
export async function goalSeek(
  ctx: DocumentContext,
  sheetId: SheetId,
  targetCell: string,
  targetValue: number,
  changingCell: string,
): Promise<GoalSeekResult> {
  // Resolve A1 references to row/col positions
  const targetPos = resolveCell(targetCell);
  const changingPos = resolveCell(changingCell);

  // Get CellIds for both cells (they must already exist)
  const formulaCellId = await CellOps.getCellIdAt(ctx, sheetId, targetPos.row, targetPos.col);
  if (!formulaCellId) {
    throw new KernelError('COMPUTE_ERROR', `Target cell ${targetCell} has no content.`);
  }
  const inputCellId = await CellOps.getCellIdAt(ctx, sheetId, changingPos.row, changingPos.col);
  if (!inputCellId) {
    throw new KernelError('COMPUTE_ERROR', `Changing cell ${changingCell} has no content.`);
  }

  if (formulaCellId === inputCellId) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `Goal seek target cell ${targetCell} cannot be the same as changing cell ${changingCell}.`,
    );
  }

  // Get current value of changing cell as initial guess
  const changingData = await CellOps.getCell(ctx, sheetId, changingPos.row, changingPos.col);
  const initialGuess = typeof changingData?.value === 'number' ? changingData.value : 0;

  // Call bridge with wire-type params (snake_case field names)
  const bridgeResult = await ctx.computeBridge.goalSeek({
    formula_cell: formulaCellId,
    target: targetValue,
    input_cell: inputCellId,
    initial_guess: initialGuess,
  });

  // Both NAPI and WASM transports normalise snake_case → camelCase at the
  // boundary (see infra/transport/src/case-normalize.ts), so cast to the
  // camelCase shape to access properties safely.
  const result = bridgeResult as unknown as {
    found: boolean;
    solutionValue?: number;
    achievedValue?: number;
    iterations: number;
  };

  // If a solution was found, apply it to the changing cell
  if (result.found && result.solutionValue != null) {
    await CellOps.setCell(ctx, sheetId, changingPos.row, changingPos.col, result.solutionValue);
  }

  // Map bridge result to contract GoalSeekResult
  return {
    found: result.found,
    value: result.solutionValue,
    iterations: result.iterations,
  };
}
