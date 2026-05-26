/**
 * What-If Analysis Types
 *
 * Types for Goal Seek and Data Tables - features that explore hypothetical
 * scenarios by evaluating formulas with different input values without
 * actually modifying the spreadsheet.
 *
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellValue } from '@mog/types-core/core';

// =============================================================================
// Goal Seek Types
// =============================================================================

/**
 * Parameters for Goal Seek algorithm.
 *
 * Goal Seek finds a value for the changing cell that makes the target cell
 * equal to the target value. It uses an iterative numerical method.
 */
export interface GoalSeekParams {
  /**
   * Function that evaluates the target cell given a value for the changing cell.
   * This function is called repeatedly during the search.
   *
   * @param x - The hypothetical value for the changing cell
   * @returns The resulting value of the target cell
   */
  evaluate: (x: number) => number;

  /**
   * The target value we want the target cell to reach.
   */
  target: number;

  /**
   * Initial guess for the changing cell value.
   * A good initial guess can speed up convergence.
   */
  initialGuess: number;

  /**
   * Maximum number of iterations before giving up.
   * @default 100
   */
  maxIterations?: number;

  /**
   * Precision threshold - stop when |f(x) - target| < precision.
   * @default 0.00001
   */
  precision?: number;

  /**
   * Maximum allowed change per iteration (prevents divergence).
   * @default 1000000
   */
  maxChange?: number;
}

/**
 * Result of Goal Seek operation.
 */
export interface GoalSeekResult {
  /**
   * Whether a solution was found within the precision threshold.
   */
  found: boolean;

  /**
   * The value for the changing cell that achieves the target (if found).
   */
  solutionValue?: number;

  /**
   * The actual value achieved in the target cell.
   * May differ from target if solution was approximate.
   */
  achievedValue?: number;

  /**
   * Number of iterations performed.
   */
  iterations: number;

  /**
   * Error type if solution was not found.
   */
  error?: 'no_solution' | 'diverged' | 'non_numeric' | 'max_iterations';

  /**
   * Human-readable error message.
   */
  errorMessage?: string;
}

// =============================================================================
// Data Table Types
// =============================================================================

/**
 * Parameters for Data Table operation.
 *
 * Data Tables evaluate a formula with different input values and display
 * the results in a grid. Supports one-variable and two-variable tables.
 *
 * One-variable table: Either rowInputCellId or colInputCellId is set (not both)
 * Two-variable table: Both rowInputCellId and colInputCellId are set
 */
export interface DataTableParams {
  /**
   * The cell containing the formula to evaluate.
   */
  formulaCellId: CellId;

  /**
   * The input cell to substitute with row header values.
   * For one-variable tables with horizontal layout, or two-variable tables.
   * null for one-variable tables with vertical layout.
   */
  rowInputCellId: CellId | null;

  /**
   * The input cell to substitute with column header values.
   * For one-variable tables with vertical layout, or two-variable tables.
   * null for one-variable tables with horizontal layout.
   */
  colInputCellId: CellId | null;

  /**
   * Values to substitute for the row input cell.
   * These become the row headers in the result.
   */
  rowValues: CellValue[];

  /**
   * Values to substitute for the column input cell.
   * These become the column headers in the result.
   */
  colValues: CellValue[];

  /**
   * Progress callback for large tables.
   * @param percent - Progress percentage (0-100)
   */
  onProgress?: (percent: number) => void;

  /**
   * AbortSignal for cancellation support.
   */
  signal?: AbortSignal;
}

/**
 * Result of Data Table operation.
 */
export interface DataTableResult {
  /**
   * 2D array of computed results.
   * results[rowIndex][colIndex] is the value when:
   * - rowInputCell = rowValues[rowIndex]
   * - colInputCell = colValues[colIndex]
   */
  results: CellValue[][];

  /**
   * Total number of cells computed.
   */
  cellCount: number;

  /**
   * Time taken in milliseconds.
   */
  elapsedMs: number;

  /**
   * Whether the operation was cancelled.
   */
  cancelled?: boolean;
}

/**
 * Persistent Data Table creation options.
 *
 * `tableRange` is the full anchor-inclusive table selection. The worksheet is
 * implied by the Worksheet API instance.
 */
export interface CreateDataTableOptions {
  /**
   * Full A1 range selected for the Data Table, including formula/header cells.
   */
  tableRange: string;

  /**
   * Excel row input cell. It receives top-row header values.
   */
  rowInputCell?: string | null;

  /**
   * Excel column input cell. It receives left-column header values.
   */
  colInputCell?: string | null;
}

/**
 * Result of creating a persistent Data Table region.
 */
export interface CreateDataTableResult {
  regionId: string;
  tableRange: string;
  bodyRange: string;
  rowInputCell?: string | null;
  colInputCell?: string | null;
  rowsComputed: number;
  colsComputed: number;
  cellCount: number;
}
