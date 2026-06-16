import type { CellWriteOptions } from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

export type SetCellsValueEntry = {
  addr?: string;
  address?: string;
  row?: number;
  col?: number;
  value: CellValuePrimitive | Date;
};

export type SetCellsFormulaEntry = {
  addr?: string;
  address?: string;
  cell?: string;
  row?: number;
  col?: number;
  formula: string;
};

export type SetCellsEntry = SetCellsValueEntry | SetCellsFormulaEntry;

export type NormalizedSetCellsEntry = {
  addr?: string;
  address?: string;
  row?: number;
  col?: number;
  value: CellValuePrimitive | Date;
};

export type ExplicitTextWriteOptions = {
  literal?: boolean;
  asText?: boolean;
};

export type FormulaCellWriteOptions = CellWriteOptions & ExplicitTextWriteOptions;

export function isExplicitTextWrite(options: ExplicitTextWriteOptions | undefined) {
  return options?.literal === true || options?.asText === true;
}

export function formulaAddressHint(operation: string, received: string): KernelError {
  const suggestion = 'Use worksheet.evaluateFormula(formula) to evaluate formula text.';
  return new KernelError(
    'API_INVALID_ADDRESS',
    `${operation}: formula text was passed where a cell address was expected: "${received}"`,
    {
      path: ['address'],
      suggestion,
      context: {
        validationKind: 'formulaTextAsAddress',
        operation,
        expected: 'cell address such as "A1"',
        received,
        suggestion,
      },
    },
  );
}

export function normalizeFormulaExpression(formula: unknown, operation: string): string {
  const suggestion = formulaUsageSuggestion(operation);
  if (formula === undefined) {
    throw new KernelError('API_INVALID_ARGUMENT', `${operation}: missing formula argument`, {
      path: ['formula'],
      suggestion,
      context: {
        validationKind: 'missingFormula',
        operation,
        expected: 'formula string',
        received: 'undefined',
        suggestion,
      },
    });
  }
  if (typeof formula !== 'string') {
    const received = describeReceivedValue(formula);
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: formula must be a string, received ${received}`,
      {
        path: ['formula'],
        suggestion,
        context: {
          validationKind: 'invalidFormulaType',
          operation,
          expected: 'formula string',
          received,
          suggestion,
        },
      },
    );
  }
  const trimmed = formula.trim();
  if (trimmed === '' || trimmed === '=') {
    throw new KernelError('API_INVALID_ARGUMENT', `${operation}: formula expression is empty`, {
      path: ['formula'],
      suggestion,
      context: {
        validationKind: 'emptyFormula',
        operation,
        expected: 'non-empty formula expression',
        received: formula,
        suggestion,
      },
    });
  }
  return trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
}

export function normalizeFormulaA1(formula: unknown, operation: string): string {
  return `=${normalizeFormulaExpression(formula, operation)}`;
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
    throw formulaTextHint(operation, value);
  }
}

function formulaTextHint(operation: string, received: string): KernelError {
  const formula = normalizeFormulaA1(received, operation);
  const suggestion = `Use worksheet.setFormula(address, "${formula}") to write a formula, or pass { asText: true } to store the text literally.`;
  return new KernelError(
    'API_INVALID_ARGUMENT',
    `${operation}: formula-shaped text is ambiguous without explicit formula/text intent: "${received}"`,
    {
      suggestion,
      context: {
        validationKind: 'formulaTextAsValue',
        operation,
        expected: 'literal value text or explicit formula API',
        received,
        suggestion,
      },
    },
  );
}

function describeReceivedValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formulaUsageSuggestion(operation: string): string {
  if (operation === 'worksheet.setFormula') {
    return 'Call worksheet.setFormula("A1", "=SUM(B1:B10)") or worksheet.setFormula("A1", "SUM(B1:B10)").';
  }
  if (operation === 'worksheet.setFormulas') {
    return 'Pass a non-empty 2D formula array such as [["=SUM(B1:B10)"]].';
  }
  if (operation === 'worksheet.setCells') {
    return 'Use entries like { cell: "A1", formula: "=SUM(B1:B10)" } for formulas, or { cell: "A1", value } for values.';
  }
  if (operation === 'worksheet.evaluate' || operation === 'worksheet.evaluateFormula') {
    return 'Pass a formula expression such as "=SUM(B1:B10)" or "SUM(B1:B10)".';
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
