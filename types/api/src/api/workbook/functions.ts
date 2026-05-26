/**
 * WorkbookFunctions -- Sub-API for programmatic function invocation.
 *
 * Provides namespaced access to spreadsheet function evaluation without
 * writing to any cell.
 *
 * Usage: `const result = await wb.functions.sum("A1:A10")`
 */

type CellValue = string | number | boolean | null;

export interface WorkbookFunctions {
  /**
   * Invoke any spreadsheet function by name with arbitrary arguments.
   * @param functionName - The function name (e.g. 'VLOOKUP', 'SUM').
   * @param args - Arguments: cell/range refs as strings, literals as values.
   * @returns The evaluated result.
   */
  invoke(functionName: string, ...args: unknown[]): Promise<CellValue>;

  /**
   * VLOOKUP function.
   * @param lookupValue - The value to search for.
   * @param tableArray - The range reference (e.g. "A1:C10").
   * @param colIndex - Column index (1-based) to return.
   * @param rangeLookup - Whether to use approximate match (default: false).
   */
  vlookup(
    lookupValue: CellValue,
    tableArray: string,
    colIndex: number,
    rangeLookup?: boolean,
  ): Promise<CellValue>;

  /** SUM function. */
  sum(...ranges: string[]): Promise<number>;

  /** AVERAGE function. */
  average(...ranges: string[]): Promise<number>;

  /** COUNT function. */
  count(...ranges: string[]): Promise<number>;

  /** MAX function. */
  max(...ranges: string[]): Promise<number>;

  /** MIN function. */
  min(...ranges: string[]): Promise<number>;

  /** CONCATENATE function. */
  concatenate(...values: CellValue[]): Promise<string>;
}
