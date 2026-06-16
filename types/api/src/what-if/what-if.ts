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
import type { OperationReceiptBase } from '../api/operation-receipt';

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

export interface DataTableComputeReceipt extends OperationReceiptBase {
  readonly kind: 'dataTable.compute';
  readonly status: 'completed' | 'failed' | 'unsupported' | 'cancelled' | 'timedOut';
  readonly lifecycle: 'transient';
  readonly materialized: false;
  readonly worksheetChanged: false;

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
 * Result of a transient Data Table compute operation.
 */
export interface DataTableResult extends DataTableComputeReceipt {}

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

export interface DataTableDescriptor {
  readonly regionId: string;
  readonly sheetId: string;
  readonly lifecycle: 'live';
  readonly materialized: boolean;
  readonly bodyRange: string;
  readonly tableRange?: string;
  readonly anchorAddress: string;
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly rowsComputed: number;
  readonly colsComputed: number;
  readonly cellCount: number;
  readonly rowInputCell?: string | null;
  readonly colInputCell?: string | null;
}

/**
 * Result of creating a persistent Data Table region.
 */
export interface DataTableCreateReceipt extends OperationReceiptBase {
  readonly kind: 'dataTable.create';
  readonly status: 'applied' | 'partial' | 'failed' | 'unsupported';
  readonly lifecycle: 'live';
  readonly materialized: boolean;
  readonly worksheetChanged: boolean;
  regionId: string;
  tableRange: string;
  bodyRange: string;
  rowInputCell?: string | null;
  colInputCell?: string | null;
  rowsComputed: number;
  colsComputed: number;
  cellCount: number;
}

export interface CreateDataTableResult extends DataTableCreateReceipt {}

export interface RefreshDataTableOptions {
  /**
   * Reserved for future recalculation policy once the compute bridge exposes a
   * dedicated Data Table refresh mutation.
   */
  force?: boolean;
}

export interface DataTableRefreshReceipt extends OperationReceiptBase {
  readonly kind: 'dataTable.refresh';
  readonly status: 'applied' | 'noOp' | 'partial' | 'failed' | 'unsupported';
  readonly lifecycle: 'live';
  readonly materialized: boolean;
  readonly worksheetChanged: boolean;
  readonly target: string;
  readonly regionId?: string;
  readonly bodyRange?: string;
  readonly tableRange?: string;
  readonly cellCount?: number;
}

export interface WriteDataTableValuesOptions {
  readonly rowInputCell?: string | null;
  readonly colInputCell?: string | null;
  readonly rowValues: readonly (string | number | boolean | null)[];
  readonly colValues: readonly (string | number | boolean | null)[];
  /**
   * A1 range that will receive the computed result grid as static values.
   * This is the output/body range only, not the formula/header range.
   */
  readonly targetRange: string;
}

export interface DataTableWriteStaticValuesReceipt extends OperationReceiptBase {
  readonly kind: 'dataTable.writeStaticValues';
  readonly status:
    | 'applied'
    | 'noOp'
    | 'partial'
    | 'failed'
    | 'unsupported'
    | 'cancelled'
    | 'timedOut';
  readonly lifecycle: 'staticValues';
  readonly materialized: boolean;
  readonly worksheetChanged: boolean;
  readonly targetRange: string;
  readonly results: CellValue[][];
  readonly cellCount: number;
  readonly cellsWritten: number;
  readonly elapsedMs: number;
}
