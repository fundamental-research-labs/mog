/**
 * WorksheetWhatIf — Sub-API for What-If analysis tools.
 *
 * Goal Seek, Data Tables, and future parametric analysis operations
 * (solver, Monte Carlo, etc.).
 */
import type { CellValue } from '@mog/types-core/core';
import type {
  CreateDataTableOptions,
  CreateDataTableResult,
  DataTableDescriptor,
  DataTableRefreshReceipt,
  DataTableWriteStaticValuesReceipt,
  DataTableResult,
  RefreshDataTableOptions,
  WriteDataTableValuesOptions,
} from '../../what-if/what-if';
import type { GoalSeekResult } from '../types';

/** Sub-API for What-If analysis operations. */
export interface WorksheetWhatIf {
  /**
   * Find the input value that makes a formula produce a target result
   * (Excel's "Goal Seek" equivalent).
   *
   * Use this to back-solve for an unknown assumption — e.g., find the
   * discount rate that produces a specific NPV, or the growth rate
   * needed to hit a revenue target.
   *
   * Example — find WACC that yields NPV = 0:
   * ```
   * // B1 = WACC assumption, B5 = =NPV(B1, C10:C20)
   * const result = await ws.whatIf.goalSeek('B5', 0, 'B1');
   * if (result.found) {
   *   await ws.setCell('B1', result.value);
   * }
   * ```
   *
   * The method is read-only — the changing cell is restored after evaluation.
   * Call setCellValue() yourself to apply the solution.
   *
   * @param targetCell - A1 address of the cell containing the formula to evaluate
   * @param targetValue - The desired result value
   * @param changingCell - A1 address of the input cell to vary
   * @returns GoalSeekResult with value if found
   */
  goalSeek(targetCell: string, targetValue: number, changingCell: string): Promise<GoalSeekResult>;

  /**
   * Compute a sensitivity/scenario table by evaluating a formula with
   * different input values (Excel's "What-If Data Table" equivalent).
   *
   * Use this for DCF sensitivity tables, LBO return grids, or any
   * two-dimensional parameter sweep.
   *
   * One-variable table: provide either `rowInputCell` or `colInputCell`.
   * Two-variable table: provide both.
   *
   * Example — 2D sensitivity grid (WACC x Terminal Growth Rate):
   * ```
   * // B1 = WACC assumption (e.g. 0.10)
   * // B2 = Terminal growth rate (e.g. 0.025)
   * // B3 = =NPV(B1, C10:C20) + terminal_value  (the formula to sweep)
   * const result = await ws.whatIf.dataTable('B3', {
   *   rowInputCell: 'B1',
   *   colInputCell: 'B2',
   *   rowValues: [0.08, 0.09, 0.10, 0.11, 0.12],
   *   colValues: [0.015, 0.020, 0.025, 0.030, 0.035],
   * });
   * // result.results is a 5x5 grid of NPV values
   * // Write to sheet: iterate result.results and call setCells()
   * ```
   *
   * Input cells must already contain a value before calling this method.
   * The method is read-only — input cells are restored after evaluation.
   *
   * @param formulaCell - A1 address of the cell containing the formula to evaluate
   * @param options - Input cells and substitution values
   * @returns 2D grid of computed results (DataTableResult)
   */
  dataTable(
    formulaCell: string,
    options: {
      rowInputCell?: string | null;
      colInputCell?: string | null;
      rowValues: (string | number | boolean | null)[];
      colValues: (string | number | boolean | null)[];
    },
  ): Promise<DataTableResult>;

  /**
   * Compute a Data Table and write the result grid as static worksheet values.
   *
   * This is a write operation. It does not create live Data Table metadata; use
   * `createDataTable()` for a persistent Data Table region.
   */
  writeDataTableValues(
    formulaCell: string,
    options: WriteDataTableValuesOptions,
  ): Promise<DataTableWriteStaticValuesReceipt>;

  /**
   * Create a persistent two-variable Data Table over the selected table range.
   *
   * Unlike `dataTable()`, this is a write operation. It stores the Data Table
   * region as workbook metadata so recalculation, readback, and future XLSX
   * export use the same compute-owned authority.
   */
  createDataTable(options: CreateDataTableOptions): Promise<CreateDataTableResult>;

  /**
   * Describe persistent Data Table regions intersecting `range`.
   *
   * When omitted, the used range is scanned through the same cell metadata path
   * used by rendering and formula-bar reads.
   */
  describeDataTables(range?: string): Promise<DataTableDescriptor[]>;

  /**
   * Refresh a persistent Data Table region by id or A1 range.
   *
   * The current compute bridge does not expose a dedicated refresh mutation yet,
   * so implementations must return an explicit unsupported receipt rather than
   * silently falling back to static writes.
   */
  refreshDataTable(
    regionIdOrRange: string,
    options?: RefreshDataTableOptions,
  ): Promise<DataTableRefreshReceipt>;
}
