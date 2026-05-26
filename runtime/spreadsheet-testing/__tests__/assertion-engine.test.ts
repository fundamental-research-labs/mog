/**
 * Tests for AssertionEngine
 */

import type { CellAssertion } from '@mog-sdk/contracts/testing';
import { AssertionEngine, type ICellValueProvider } from '../src/assertion-engine';

// Mock value provider
function createMockValueProvider(values: Map<string, unknown> = new Map()): ICellValueProvider {
  return {
    getCellValue(sheetId: string, row: number, col: number): unknown {
      return values.get(`${sheetId}:${row}:${col}`);
    },
    getRangeValues(
      sheetId: string,
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number,
    ): unknown[][] {
      const result: unknown[][] = [];
      for (let r = startRow; r <= endRow; r++) {
        const rowValues: unknown[] = [];
        for (let c = startCol; c <= endCol; c++) {
          rowValues.push(values.get(`${sheetId}:${r}:${c}`));
        }
        result.push(rowValues);
      }
      return result;
    },
  };
}

// Helper to create cell assertions
function createAssertion(overrides: Partial<CellAssertion> = {}): CellAssertion {
  return {
    id: 'test-assertion',
    target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
    type: 'equals',
    params: {},
    severity: 'error',
    enabled: true,
    ...overrides,
  };
}

describe('AssertionEngine', () => {
  describe('equals assertion', () => {
    it('should pass when values are equal', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'equals',
        params: { expected: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when values are not equal', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'equals',
        params: { expected: 200 },
      });

      const results = engine.evaluate(assertion);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('Expected 200, got 100');
    });

    it('should handle string comparison', () => {
      const values = new Map([['sheet1:0:0', 'hello']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'equals',
        params: { expected: 'hello' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should handle numeric tolerance', () => {
      const values = new Map([['sheet1:0:0', 0.1 + 0.2]]); // ~0.30000000000000004
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'equals',
        params: { expected: 0.3 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });
  });

  describe('notEquals assertion', () => {
    it('should pass when values are different', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'notEquals',
        params: { expected: 200 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when values are equal', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'notEquals',
        params: { expected: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('greaterThan assertion', () => {
    it('should pass when value is greater', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'greaterThan',
        params: { threshold: 50 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when value equals threshold', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'greaterThan',
        params: { threshold: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });

    it('should fail for non-numeric values', () => {
      const values = new Map([['sheet1:0:0', 'hello']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'greaterThan',
        params: { threshold: 50 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('non-numeric');
    });
  });

  describe('lessThan assertion', () => {
    it('should pass when value is less', () => {
      const values = new Map([['sheet1:0:0', 30]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'lessThan',
        params: { threshold: 50 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when value is greater', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'lessThan',
        params: { threshold: 50 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('between assertion', () => {
    it('should pass when value is within range', () => {
      const values = new Map([['sheet1:0:0', 50]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'between',
        params: { min: 0, max: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should pass on boundary values', () => {
      const engine1 = new AssertionEngine(createMockValueProvider(new Map([['sheet1:0:0', 0]])));
      const engine2 = new AssertionEngine(createMockValueProvider(new Map([['sheet1:0:0', 100]])));

      const assertion = createAssertion({
        type: 'between',
        params: { min: 0, max: 100 },
      });

      expect(engine1.evaluate(assertion)[0].passed).toBe(true);
      expect(engine2.evaluate(assertion)[0].passed).toBe(true);
    });

    it('should fail when value is outside range', () => {
      const values = new Map([['sheet1:0:0', 150]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'between',
        params: { min: 0, max: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('notEmpty assertion', () => {
    it('should pass when cell has a value', () => {
      const values = new Map([['sheet1:0:0', 'data']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'notEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when cell is empty', () => {
      const values = new Map([['sheet1:0:0', '']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'notEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });

    it('should fail when cell is null', () => {
      const values = new Map([['sheet1:0:0', null]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'notEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });

    it('should fail when cell is whitespace only', () => {
      const values = new Map([['sheet1:0:0', '   ']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'notEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('isEmpty assertion', () => {
    it('should pass when cell is empty', () => {
      const values = new Map([['sheet1:0:0', '']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'isEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when cell has value', () => {
      const values = new Map([['sheet1:0:0', 'data']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'isEmpty' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('isType assertion', () => {
    it('should pass for matching number type', () => {
      const values = new Map([['sheet1:0:0', 42]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'isType',
        params: { expectedType: 'number' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should pass for matching string type', () => {
      const values = new Map([['sheet1:0:0', 'hello']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'isType',
        params: { expectedType: 'string' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should pass for matching boolean type', () => {
      const values = new Map([['sheet1:0:0', true]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'isType',
        params: { expectedType: 'boolean' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should detect error type', () => {
      const values = new Map([['sheet1:0:0', { type: 'error', value: 'Div0' }]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'isType',
        params: { expectedType: 'error' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail for mismatched type', () => {
      const values = new Map([['sheet1:0:0', 'hello']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'isType',
        params: { expectedType: 'number' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('matchesPattern assertion', () => {
    it('should pass when value matches pattern', () => {
      const values = new Map([['sheet1:0:0', 'test@example.com']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'matchesPattern',
        params: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when value does not match pattern', () => {
      const values = new Map([['sheet1:0:0', 'not-an-email']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'matchesPattern',
        params: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });

    it('should handle invalid regex', () => {
      const values = new Map([['sheet1:0:0', 'test']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        type: 'matchesPattern',
        params: { pattern: '[invalid' },
      });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('Invalid regex');
    });
  });

  describe('noError assertion', () => {
    it('should pass when cell has no error', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'noError' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(true);
    });

    it('should fail when cell has error object', () => {
      const values = new Map([['sheet1:0:0', { type: 'error', value: 'Div0' }]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'noError' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('Div0');
    });

    it('should fail when cell has error string', () => {
      const values = new Map([['sheet1:0:0', '#REF!']]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({ type: 'noError' });

      const results = engine.evaluate(assertion);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('range assertions', () => {
    it('should evaluate each cell in a range', () => {
      const values = new Map([
        ['sheet1:0:0', 10],
        ['sheet1:0:1', 20],
        ['sheet1:1:0', 30],
        ['sheet1:1:1', 40],
      ]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        target: {
          type: 'range',
          sheetId: 'sheet1',
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 1,
        },
        type: 'greaterThan',
        params: { threshold: 0 },
      });

      const results = engine.evaluate(assertion);
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  describe('disabled assertions', () => {
    it('should return empty results for disabled assertions', () => {
      const values = new Map([['sheet1:0:0', 100]]);
      const engine = new AssertionEngine(createMockValueProvider(values));

      const assertion = createAssertion({
        enabled: false,
        type: 'equals',
        params: { expected: 100 },
      });

      const results = engine.evaluate(assertion);
      expect(results).toHaveLength(0);
    });
  });
});
