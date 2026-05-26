/**
 * WorkbookFunctionsImpl -- Implementation of the WorkbookFunctions sub-API.
 *
 * Evaluates spreadsheet functions programmatically by constructing formula
 * strings and delegating to the Rust `evaluate_expression` bridge endpoint.
 *
 * Dependencies are injected from WorkbookImpl to avoid exposing internals.
 */
import type { WorkbookFunctions } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../context';

type CellValue = string | number | boolean | null;

export class WorkbookFunctionsImpl implements WorkbookFunctions {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly getActiveSheetId: () => SheetId,
  ) {}

  async invoke(functionName: string, ...args: unknown[]): Promise<CellValue> {
    const formula = `=${functionName}(${args.map(serializeArg).join(',')})`;
    const result = await this.ctx.computeBridge.evaluateExpression(
      this.getActiveSheetId(),
      formula,
    );
    return toCellValue(result);
  }

  async vlookup(
    lookupValue: CellValue,
    tableArray: string,
    colIndex: number,
    rangeLookup?: boolean,
  ): Promise<CellValue> {
    return this.invoke('VLOOKUP', lookupValue, tableArray, colIndex, rangeLookup ?? false);
  }

  async sum(...ranges: string[]): Promise<number> {
    const result = await this.invoke('SUM', ...ranges);
    return typeof result === 'number' ? result : 0;
  }

  async average(...ranges: string[]): Promise<number> {
    const result = await this.invoke('AVERAGE', ...ranges);
    return typeof result === 'number' ? result : 0;
  }

  async count(...ranges: string[]): Promise<number> {
    const result = await this.invoke('COUNT', ...ranges);
    return typeof result === 'number' ? result : 0;
  }

  async max(...ranges: string[]): Promise<number> {
    const result = await this.invoke('MAX', ...ranges);
    return typeof result === 'number' ? result : 0;
  }

  async min(...ranges: string[]): Promise<number> {
    const result = await this.invoke('MIN', ...ranges);
    return typeof result === 'number' ? result : 0;
  }

  async concatenate(...values: CellValue[]): Promise<string> {
    const result = await this.invoke('CONCATENATE', ...values);
    return String(result);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a function argument into formula text.
 *
 * - Cell/range refs and named ranges pass through unquoted (e.g. "A1:B10").
 * - String literals are double-quoted with escaping.
 * - Numbers and booleans are converted to their formula representations.
 */
function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') {
    // Cell/range refs (A1, $A$1, A:A, 1:1, Sheet1!A1:B2), named ranges, structured refs
    if (
      /^('?[^']*'?!)?\$?[A-Z]+\$?\d*(:\$?[A-Z]+\$?\d*)?$/i.test(arg) ||
      /^('?[^']*'?!)?\d+:\d+$/i.test(arg) ||
      /^[A-Za-z_]\w*$/.test(arg) ||
      /^[A-Za-z_]\w*\[/.test(arg)
    ) {
      return arg;
    }
    return `"${arg.replace(/"/g, '""')}"`;
  }
  if (typeof arg === 'number') return String(arg);
  if (typeof arg === 'boolean') return arg ? 'TRUE' : 'FALSE';
  if (arg === null || arg === undefined) return '';
  return String(arg);
}

/** Normalize the bridge return value to a plain CellValue. */
function toCellValue(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  // Bridge may return { Number: n } or { Text: s } or { Boolean: b } or "Null"
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('Number' in obj) return obj.Number as number;
    if ('Text' in obj) return obj.Text as string;
    if ('Boolean' in obj) return obj.Boolean as boolean;
  }
  if (raw === 'Null') return null;
  return null;
}
