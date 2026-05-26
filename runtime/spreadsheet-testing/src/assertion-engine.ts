/**
 * Assertion Engine
 *
 * Evaluates cell assertions and returns test results.
 * This is the core logic for determining if cells pass their assertions.
 */

import type {
  AssertionTarget,
  AssertionType,
  CellAssertion,
  TestResult,
} from '@mog-sdk/contracts/testing';

/**
 * Interface for getting cell values from the spreadsheet store.
 * This decouples the assertion engine from the specific store implementation.
 */
export interface ICellValueProvider {
  /**
   * Get the computed/display value for a cell
   */
  getCellValue(sheetId: string, row: number, col: number): unknown;

  /**
   * Get values for a range of cells
   */
  getRangeValues(
    sheetId: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): unknown[][];
}

/**
 * AssertionEngine - evaluates cell assertions
 */
export class AssertionEngine {
  constructor(private valueProvider: ICellValueProvider) {}

  /**
   * Evaluate a single assertion and return the result
   */
  evaluate(assertion: CellAssertion): TestResult[] {
    if (!assertion.enabled) {
      return [];
    }

    const startTime = performance.now();

    if (assertion.target.type === 'cell') {
      const result = this.evaluateCellAssertion(assertion, assertion.target);
      result.durationMs = performance.now() - startTime;
      return [result];
    } else {
      // Range assertion - evaluate each cell in range
      const results: TestResult[] = [];
      const { sheetId, startRow, startCol, endRow, endCol } = assertion.target;

      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const cellTarget = { type: 'cell' as const, sheetId, row, col };
          const result = this.evaluateCellAssertion(assertion, cellTarget);
          results.push(result);
        }
      }

      // Add duration to first result
      if (results.length > 0) {
        results[0].durationMs = performance.now() - startTime;
      }

      return results;
    }
  }

  /**
   * Evaluate an assertion for a single cell
   */
  private evaluateCellAssertion(
    assertion: CellAssertion,
    target: AssertionTarget & { type: 'cell' },
  ): TestResult {
    const { sheetId, row, col } = target;
    const value = this.valueProvider.getCellValue(sheetId, row, col);
    const timestamp = Date.now();

    const baseResult: TestResult = {
      assertionId: assertion.id,
      assertionName: assertion.name,
      address: { sheetId, row, col },
      passed: false,
      actual: value,
      severity: assertion.severity,
      timestamp,
    };

    try {
      const evaluationResult = this.evaluateType(
        assertion.type,
        value,
        assertion.params,
        assertion,
        target,
      );

      return {
        ...baseResult,
        passed: evaluationResult.passed,
        expected: evaluationResult.expected,
        message: evaluationResult.passed
          ? undefined
          : evaluationResult.message || assertion.message,
      };
    } catch (error) {
      return {
        ...baseResult,
        passed: false,
        message: `Assertion error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Evaluate based on assertion type
   */
  private evaluateType(
    type: AssertionType,
    value: unknown,
    params: CellAssertion['params'],
    assertion: CellAssertion,
    target: AssertionTarget & { type: 'cell' },
  ): { passed: boolean; expected?: unknown; message?: string } {
    switch (type) {
      case 'equals':
        return this.evaluateEquals(value, params.expected);

      case 'notEquals':
        return this.evaluateNotEquals(value, params.expected);

      case 'greaterThan':
        return this.evaluateGreaterThan(value, params.threshold);

      case 'lessThan':
        return this.evaluateLessThan(value, params.threshold);

      case 'greaterOrEqual':
        return this.evaluateGreaterOrEqual(value, params.threshold);

      case 'lessOrEqual':
        return this.evaluateLessOrEqual(value, params.threshold);

      case 'between':
        return this.evaluateBetween(value, params.min, params.max);

      case 'notEmpty':
        return this.evaluateNotEmpty(value);

      case 'isEmpty':
        return this.evaluateIsEmpty(value);

      case 'isType':
        return this.evaluateIsType(value, params.expectedType);

      case 'isUnique':
        return this.evaluateIsUnique(value, assertion, target);

      case 'matchesPattern':
        return this.evaluateMatchesPattern(value, params.pattern);

      case 'noError':
        return this.evaluateNoError(value);

      case 'formula':
        // Formula assertions need special handling with the formula evaluator
        // For now, return a placeholder that TestRunner will handle
        return {
          passed: false,
          message: 'Formula assertions require TestRunner context',
        };

      default:
        return {
          passed: false,
          message: `Unknown assertion type: ${type}`,
        };
    }
  }

  // ===========================================================================
  // Individual Assertion Evaluators
  // ===========================================================================

  private evaluateEquals(
    value: unknown,
    expected: unknown,
  ): { passed: boolean; expected?: unknown; message?: string } {
    // Handle numeric comparison with tolerance
    if (typeof value === 'number' && typeof expected === 'number') {
      const tolerance = 1e-10;
      const passed = Math.abs(value - expected) < tolerance;
      return {
        passed,
        expected,
        message: passed ? undefined : `Expected ${expected}, got ${value}`,
      };
    }

    const passed = value === expected;
    return {
      passed,
      expected,
      message: passed ? undefined : `Expected ${expected}, got ${value}`,
    };
  }

  private evaluateNotEquals(
    value: unknown,
    expected: unknown,
  ): { passed: boolean; expected?: unknown; message?: string } {
    const passed = value !== expected;
    return {
      passed,
      expected: `not ${expected}`,
      message: passed ? undefined : `Expected value to not equal ${expected}`,
    };
  }

  private evaluateGreaterThan(
    value: unknown,
    threshold?: number,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (threshold === undefined) {
      return { passed: false, message: 'No threshold specified for greaterThan assertion' };
    }

    const numValue = this.toNumber(value);
    if (numValue === null) {
      return {
        passed: false,
        expected: `> ${threshold}`,
        message: `Cannot compare non-numeric value "${value}" with threshold`,
      };
    }

    const passed = numValue > threshold;
    return {
      passed,
      expected: `> ${threshold}`,
      message: passed ? undefined : `Expected > ${threshold}, got ${numValue}`,
    };
  }

  private evaluateLessThan(
    value: unknown,
    threshold?: number,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (threshold === undefined) {
      return { passed: false, message: 'No threshold specified for lessThan assertion' };
    }

    const numValue = this.toNumber(value);
    if (numValue === null) {
      return {
        passed: false,
        expected: `< ${threshold}`,
        message: `Cannot compare non-numeric value "${value}" with threshold`,
      };
    }

    const passed = numValue < threshold;
    return {
      passed,
      expected: `< ${threshold}`,
      message: passed ? undefined : `Expected < ${threshold}, got ${numValue}`,
    };
  }

  private evaluateGreaterOrEqual(
    value: unknown,
    threshold?: number,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (threshold === undefined) {
      return { passed: false, message: 'No threshold specified for greaterOrEqual assertion' };
    }

    const numValue = this.toNumber(value);
    if (numValue === null) {
      return {
        passed: false,
        expected: `>= ${threshold}`,
        message: `Cannot compare non-numeric value "${value}" with threshold`,
      };
    }

    const passed = numValue >= threshold;
    return {
      passed,
      expected: `>= ${threshold}`,
      message: passed ? undefined : `Expected >= ${threshold}, got ${numValue}`,
    };
  }

  private evaluateLessOrEqual(
    value: unknown,
    threshold?: number,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (threshold === undefined) {
      return { passed: false, message: 'No threshold specified for lessOrEqual assertion' };
    }

    const numValue = this.toNumber(value);
    if (numValue === null) {
      return {
        passed: false,
        expected: `<= ${threshold}`,
        message: `Cannot compare non-numeric value "${value}" with threshold`,
      };
    }

    const passed = numValue <= threshold;
    return {
      passed,
      expected: `<= ${threshold}`,
      message: passed ? undefined : `Expected <= ${threshold}, got ${numValue}`,
    };
  }

  private evaluateBetween(
    value: unknown,
    min?: number,
    max?: number,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (min === undefined || max === undefined) {
      return { passed: false, message: 'Both min and max must be specified for between assertion' };
    }

    const numValue = this.toNumber(value);
    if (numValue === null) {
      return {
        passed: false,
        expected: `between ${min} and ${max}`,
        message: `Cannot compare non-numeric value "${value}" with range`,
      };
    }

    const passed = numValue >= min && numValue <= max;
    return {
      passed,
      expected: `between ${min} and ${max}`,
      message: passed ? undefined : `Expected between ${min} and ${max}, got ${numValue}`,
    };
  }

  private evaluateNotEmpty(value: unknown): {
    passed: boolean;
    expected?: unknown;
    message?: string;
  } {
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '');

    return {
      passed: !isEmpty,
      expected: 'not empty',
      message: isEmpty ? 'Expected cell to not be empty' : undefined,
    };
  }

  private evaluateIsEmpty(value: unknown): {
    passed: boolean;
    expected?: unknown;
    message?: string;
  } {
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '');

    return {
      passed: isEmpty,
      expected: 'empty',
      message: isEmpty ? undefined : `Expected cell to be empty, got "${value}"`,
    };
  }

  private evaluateIsType(
    value: unknown,
    expectedType?: 'string' | 'number' | 'boolean' | 'date' | 'error',
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (!expectedType) {
      return { passed: false, message: 'No expected type specified for isType assertion' };
    }

    let actualType: string;
    let passed: boolean;

    if (value === null || value === undefined) {
      actualType = 'empty';
      passed = false;
    } else if (this.isError(value)) {
      actualType = 'error';
      passed = expectedType === 'error';
    } else if (this.isDate(value)) {
      actualType = 'date';
      passed = expectedType === 'date';
    } else {
      actualType = typeof value;
      passed = actualType === expectedType;
    }

    return {
      passed,
      expected: expectedType,
      message: passed ? undefined : `Expected type ${expectedType}, got ${actualType}`,
    };
  }

  private evaluateIsUnique(
    value: unknown,
    assertion: CellAssertion,
    _target: AssertionTarget & { type: 'cell' },
  ): { passed: boolean; expected?: unknown; message?: string } {
    // For uniqueness, we need to check the entire column/row/range
    const scope = assertion.params.uniqueScope || 'column';

    if (assertion.target.type !== 'range') {
      return {
        passed: false,
        message: 'isUnique assertion requires a range target',
      };
    }

    const { sheetId, startRow, startCol, endRow, endCol } = assertion.target;
    const values = this.valueProvider.getRangeValues(sheetId, startRow, startCol, endRow, endCol);

    // Count occurrences of the value
    let count = 0;
    for (const row of values) {
      for (const cellValue of row) {
        if (this.valuesEqual(cellValue, value)) {
          count++;
        }
      }
    }

    const passed = count <= 1;
    return {
      passed,
      expected: 'unique value',
      message: passed ? undefined : `Value "${value}" appears ${count} times in the ${scope}`,
    };
  }

  private evaluateMatchesPattern(
    value: unknown,
    pattern?: string,
  ): { passed: boolean; expected?: unknown; message?: string } {
    if (!pattern) {
      return { passed: false, message: 'No pattern specified for matchesPattern assertion' };
    }

    const stringValue = String(value ?? '');

    try {
      const regex = new RegExp(pattern);
      const passed = regex.test(stringValue);

      return {
        passed,
        expected: `matches /${pattern}/`,
        message: passed ? undefined : `Value "${stringValue}" does not match pattern /${pattern}/`,
      };
    } catch (_error) {
      return {
        passed: false,
        message: `Invalid regex pattern: ${pattern}`,
      };
    }
  }

  private evaluateNoError(value: unknown): {
    passed: boolean;
    expected?: unknown;
    message?: string;
  } {
    const isError = this.isError(value);

    return {
      passed: !isError,
      expected: 'no error',
      message: isError ? `Cell contains error: ${this.getErrorValue(value)}` : undefined,
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return isNaN(value) ? null : value;
    }
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  private isError(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'object' && 'type' in value && value.type === 'error') {
      return true;
    }
    if (typeof value === 'string') {
      // Check variant names
      const variants = [
        'Null',
        'Div0',
        'Value',
        'Ref',
        'Name',
        'Num',
        'Na',
        'GettingData',
        'Spill',
        'Calc',
      ];
      if (variants.includes(value)) return true;
      // Legacy display strings (from binary viewport path)
      return /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!)$/.test(
        value,
      );
    }
    return false;
  }

  private isDate(value: unknown): boolean {
    if (value instanceof Date) return true;
    // Check for Excel serial date numbers (simple heuristic)
    if (typeof value === 'number' && value > 0 && value < 2958466) {
      // Could be a date serial
      return false; // Conservative - don't assume numbers are dates
    }
    return false;
  }

  private getErrorValue(value: unknown): string {
    if (typeof value === 'object' && value !== null && 'value' in value) {
      return String((value as { value: unknown }).value);
    }
    return String(value);
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) < 1e-10;
    }
    return false;
  }
}

/**
 * Create an assertion engine with a value provider
 */
export function createAssertionEngine(valueProvider: ICellValueProvider): AssertionEngine {
  return new AssertionEngine(valueProvider);
}
