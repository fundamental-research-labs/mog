import type { CellWriteOptions } from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

export type SetCellsValueEntry = {
  addr?: string;
  address?: string;
  row?: number;
  col?: number;
  value: CellValuePrimitive | Date;
  annotation?: string | null;
};

export type SetCellsFormulaEntry = {
  addr?: string;
  address?: string;
  cell?: string;
  row?: number;
  col?: number;
  formula: string;
  annotation?: string | null;
};

export type SetCellsEntry = SetCellsValueEntry | SetCellsFormulaEntry;

export type NormalizedSetCellsEntry = {
  addr?: string;
  address?: string;
  row?: number;
  col?: number;
  value: CellValuePrimitive | Date;
  annotation?: string | null;
};

export type ExplicitTextWriteOptions = Pick<CellWriteOptions, 'literal' | 'asText' | 'annotation'>;

export type FormulaCellWriteOptions = CellWriteOptions & ExplicitTextWriteOptions;

export function isExplicitTextWrite(options: ExplicitTextWriteOptions | undefined) {
  return options?.literal === true || options?.asText === true;
}

export function formulaAddressHint(operation: string, received: string): KernelError {
  const formula = received.trim();
  const suggestion = `To evaluate this formula, call worksheet.evaluateFormula(${jsString(formula)}). To read a value already in the sheet, pass a cell address such as worksheet.getValue("A1").`;
  return new KernelError(
    'API_INVALID_ADDRESS',
    `${operation}: expected a cell address such as "A1", but received formula text ${jsString(received)}. getValue reads existing cells; it does not evaluate formula text.`,
    {
      path: ['address'],
      suggestion,
      context: {
        validationKind: 'formulaTextAsAddress',
        operation,
        expected: 'cell address such as "A1"',
        received,
        formula,
        suggestion,
      },
    },
  );
}

export function normalizeFormulaExpression(
  formula: unknown,
  operation: string,
  path = formulaArgumentPath(operation),
): string {
  const suggestion = formulaUsageSuggestion(operation);
  if (formula === undefined) {
    throw new KernelError('API_INVALID_ARGUMENT', missingFormulaMessage(operation, path), {
      path,
      suggestion,
      context: {
        validationKind: 'missingFormula',
        operation,
        expected: formulaExpectedDescription(operation),
        received: 'undefined',
        suggestion,
      },
    });
  }
  if (typeof formula !== 'string') {
    const received = describeReceivedValue(formula);
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: ${formulaPathLabel(path)} must be a string expression, received ${received}`,
      {
        path,
        suggestion,
        context: {
          validationKind: 'invalidFormulaType',
          operation,
          expected: formulaExpectedDescription(operation),
          received,
          suggestion,
        },
      },
    );
  }
  const trimmed = formula.trim();
  if (trimmed === '' || trimmed === '=') {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: ${formulaPathLabel(path)} cannot be empty. Provide an expression after the optional leading "=".`,
      {
        path,
        suggestion,
        context: {
          validationKind: 'emptyFormula',
          operation,
          expected: formulaExpectedDescription(operation),
          received: formula,
          suggestion,
        },
      },
    );
  }
  return trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
}

export function normalizeFormulaA1(formula: unknown, operation: string, path?: string[]): string {
  return `=${normalizeFormulaExpression(formula, operation, path)}`;
}

export function normalizeFormulaGrid(formulas: unknown, operation: string): string[][] {
  const suggestion = formulaUsageSuggestion(operation);
  if (formulas === undefined) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: missing required formulas array. Expected setFormulas(range, formulas).`,
      {
        path: ['formulas'],
        suggestion,
        context: {
          validationKind: 'missingFormulas',
          operation,
          expected: '2D array of formula strings, such as [["=SUM(B1:B10)"]]',
          received: 'undefined',
          suggestion,
        },
      },
    );
  }
  if (!Array.isArray(formulas)) {
    const received = describeReceivedValue(formulas);
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: formulas must be a 2D array of formula strings, received ${received}`,
      {
        path: ['formulas'],
        suggestion,
        context: {
          validationKind: 'invalidFormulasType',
          operation,
          expected: '2D array of formula strings, such as [["=SUM(B1:B10)"]]',
          received,
          suggestion,
        },
      },
    );
  }
  return formulas.map((row, rowIndex) => {
    if (!Array.isArray(row)) {
      const received = describeReceivedValue(row);
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        `${operation}: formulas[${rowIndex}] must be an array of formula strings, received ${received}`,
        {
          path: ['formulas', String(rowIndex)],
          suggestion,
          context: {
            validationKind: 'invalidFormulaRowType',
            operation,
            expected: 'array of formula strings, such as ["=SUM(B1:B10)"]',
            received,
            suggestion,
          },
        },
      );
    }
    return row.map((formula, colIndex) =>
      normalizeFormulaA1(formula, operation, ['formulas', String(rowIndex), String(colIndex)]),
    );
  });
}

export function shouldEscapeAsLiteralText(value: string): boolean {
  const text = value.trim();
  return text.startsWith('=') || looksLikeFormulaTextWithoutEquals(text);
}

export function assertNoAmbiguousFormulaText(
  operation: string,
  value: unknown,
  options: FormulaCellWriteOptions | undefined,
  mode: 'missingEqualsOnly' | 'formulaOrMissingEquals',
): void {
  if (typeof value !== 'string' || isExplicitTextWrite(options) || options?.asFormula === true) {
    return;
  }
  const text = value.trim();
  const isFormulaText =
    (mode === 'formulaOrMissingEquals' && text.startsWith('=')) ||
    looksLikeFormulaTextWithoutEquals(text);
  if (isFormulaText) {
    throw formulaTextHint(
      operation,
      value,
      text.startsWith('=') ? 'startsWithEquals' : 'missingEquals',
    );
  }
}

function formulaTextHint(
  operation: string,
  received: string,
  kind: 'startsWithEquals' | 'missingEquals',
): KernelError {
  const formula = normalizeFormulaA1(received, operation);
  const literalCall =
    operation === 'worksheet.setValue'
      ? `worksheet.setValue(address, ${jsString(received)}, { asText: true })`
      : `worksheet.setCell(address, ${jsString(received)}, { asText: true })`;
  const suggestion = `Formula: call worksheet.setFormula(address, ${jsString(formula)}). Literal text: call ${literalCall}.`;
  const message =
    kind === 'startsWithEquals'
      ? `${operation}: received formula text ${jsString(received)}, but this API writes values unless formula intent is explicit.`
      : `${operation}: ${jsString(received)} looks like a formula but is missing the leading "=". Mog cannot safely guess whether you meant a formula or literal text.`;
  return new KernelError('API_INVALID_ARGUMENT', message, {
    suggestion,
    context: {
      validationKind:
        kind === 'startsWithEquals' ? 'formulaTextAsValue' : 'formulaTextMissingEquals',
      operation,
      expected: 'explicit formula API call or explicit text write',
      received,
      formulaExample: `worksheet.setFormula(address, ${jsString(formula)})`,
      literalTextExample: literalCall,
      suggestion,
    },
  });
}

function missingFormulaMessage(operation: string, path: string[]): string {
  if (operation === 'worksheet.setFormula') {
    return `${operation}: missing required formula argument. Expected setFormula(address, formula).`;
  }
  if (operation === 'worksheet.evaluate' || operation === 'worksheet.evaluateFormula') {
    return `${operation}: missing formula expression to evaluate.`;
  }
  return `${operation}: ${formulaPathLabel(path)} is missing a formula string.`;
}

function formulaArgumentPath(operation: string): string[] {
  if (operation === 'worksheet.setFormulas') return ['formulas'];
  if (operation === 'worksheet.setCells') return ['cells', 'formula'];
  return ['formula'];
}

function formulaExpectedDescription(operation: string): string {
  if (operation === 'worksheet.setFormulas') {
    return 'formula string inside a 2D array, such as "=SUM(B1:B10)"';
  }
  return 'formula string such as "=SUM(B1:B10)" or "SUM(B1:B10)"';
}

function formulaPathLabel(path: string[]): string {
  if (path.length === 0) return 'formula';
  return path
    .map((part, index) => {
      if (/^\d+$/.test(part)) return `[${part}]`;
      return index === 0 ? part : `.${part}`;
    })
    .join('');
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function describeReceivedValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formulaUsageSuggestion(operation: string): string {
  if (operation === 'worksheet.setFormula') {
    return 'Call worksheet.setFormula("A1", "=SUM(B1:B10)"). The formula may include or omit the leading "=".';
  }
  if (operation === 'worksheet.setFormulas') {
    return 'Call worksheet.setFormulas("A1:B2", [["=SUM(B1:B10)"]]). Each populated item must be a formula string.';
  }
  if (operation === 'worksheet.setCells') {
    return 'Use { cell: "A1", formula: "=SUM(B1:B10)" } for formulas, or { cell: "A1", value } for literal values.';
  }
  if (operation === 'worksheet.evaluate' || operation === 'worksheet.evaluateFormula') {
    return 'Call worksheet.evaluateFormula("=SUM(B1:B10)") to evaluate formula text without writing to a cell.';
  }
  return 'Pass a formula expression such as "=SUM(B1:B10)" or "SUM(B1:B10)".';
}

function looksLikeFormulaTextWithoutEquals(value: string): boolean {
  const text = value.trim();
  if (text === '' || text.startsWith('=')) return false;

  const cellRef = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
  const sheetRef = String.raw`(?:'[^']+'|[A-Za-z_][A-Za-z0-9_ .]*)!${cellRef}`;
  if (new RegExp(`^${sheetRef}(?::${cellRef})?$`).test(text)) return true;
  if (new RegExp(String.raw`^[+@]\s*(?:${cellRef}|${sheetRef}|[A-Z][A-Z0-9_.]*\s*\()`).test(text)) {
    return true;
  }
  return /^[A-Z][A-Z0-9_.]*\s*\(/.test(text);
}
