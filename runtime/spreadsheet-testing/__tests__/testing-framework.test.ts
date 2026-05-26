/**
 * Integration tests for TestingFramework (no Yjs)
 */

import type { TestResult, TestRunSummary } from '@mog-sdk/contracts/testing';
import type { ICellValueProvider } from '../src/assertion-engine';
import { TestingFramework } from '../src/testing-framework';

// Mock value provider
function createMockValueProvider(
  values: Map<string, unknown> = new Map<string, unknown>(),
): ICellValueProvider {
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

describe('TestingFramework', () => {
  let framework: TestingFramework;
  let values: Map<string, unknown>;

  beforeEach(() => {
    values = new Map<string, unknown>([
      ['sheet1:0:0', 100],
      ['sheet1:0:1', 'hello'],
      ['sheet1:1:0', true],
      ['sheet1:1:1', { type: 'error', value: 'Div0' }],
    ]);

    framework = new TestingFramework({
      valueProvider: createMockValueProvider(values),
    });
  });

  afterEach(() => {
    framework.clearHandlers();
  });

  describe('full workflow', () => {
    it('should create assertion, add to suite, run suite, and get results', async () => {
      // Create assertions
      const assertion1 = framework.addAssertion({
        name: 'Check value equals 100',
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      const assertion2 = framework.addAssertion({
        name: 'Check not empty',
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 1 },
        type: 'notEmpty',
        params: {},
        severity: 'warning',
        enabled: true,
      });

      // Create suite
      const suite = framework.createSuite('Financial Model Integrity', {
        description: 'Validates key financial metrics',
      });

      // Add assertions to suite
      framework.addAssertionsToSuite(suite.id, [assertion1.id, assertion2.id]);

      // Run suite
      const results = await framework.runSuite(suite.id);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);

      // Check suite has stored results
      const updatedSuite = framework.getSuite(suite.id);
      expect(updatedSuite?.lastResults).toHaveLength(2);
      expect(updatedSuite?.lastSummary?.passed).toBe(2);
    });

    it('should detect assertion failures', async () => {
      const _assertion = framework.addAssertion({
        name: 'Wrong value check',
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 999 }, // Wrong expected value
        severity: 'error',
        enabled: true,
      });

      const results = await framework.runAll();

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe(100);
      expect(results[0].expected).toBe(999);
    });

    it('should emit events on test completion', async () => {
      let completedResults: TestResult[] = [];
      let completedSummary: TestRunSummary | undefined;

      framework.onTestsCompleted((results, summary) => {
        completedResults = results;
        completedSummary = summary;
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      await framework.runAll();

      expect(completedResults).toHaveLength(1);
      expect(completedSummary).toBeDefined();
      expect(completedSummary!.total).toBe(1);
      expect(completedSummary!.passed).toBe(1);
    });

    it('should emit events on assertion failure', async () => {
      let failedResult: TestResult | undefined;

      framework.onAssertionFailed((result) => {
        failedResult = result;
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 999 },
        severity: 'error',
        enabled: true,
      });

      await framework.runAll();

      expect(failedResult).toBeDefined();
      expect(failedResult!.passed).toBe(false);
    });
  });

  describe('assertions CRUD', () => {
    it('should create, read, update, and delete assertions', () => {
      // Create
      const assertion = framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      // Read
      expect(framework.getAssertion(assertion.id)).toBeDefined();

      // Update
      framework.updateAssertion(assertion.id, { enabled: false });
      expect(framework.getAssertion(assertion.id)?.enabled).toBe(false);

      // Delete
      framework.removeAssertion(assertion.id);
      expect(framework.getAssertion(assertion.id)).toBeUndefined();
    });

    it('should get assertions for a specific cell', () => {
      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'noError',
        params: {},
        severity: 'warning',
        enabled: true,
      });

      const assertions = framework.getAssertionsForCell('sheet1', 0, 0);
      expect(assertions).toHaveLength(2);
    });

    it('should get all assertions', () => {
      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 0 },
        type: 'isType',
        params: { expectedType: 'boolean' },
        severity: 'error',
        enabled: true,
      });

      const all = framework.getAllAssertions();
      expect(all).toHaveLength(2);
    });
  });

  describe('test suites CRUD', () => {
    it('should create, read, update, and delete suites', () => {
      // Create
      const suite = framework.createSuite('Test Suite');

      // Read
      expect(framework.getSuite(suite.id)).toBeDefined();
      expect(framework.listSuites()).toHaveLength(1);

      // Update
      framework.updateSuite(suite.id, { autoRun: true });
      expect(framework.getSuite(suite.id)?.autoRun).toBe(true);

      // Delete
      framework.deleteSuite(suite.id);
      expect(framework.getSuite(suite.id)).toBeUndefined();
    });
  });

  describe('test execution', () => {
    it('should run all assertions', async () => {
      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 1 },
        type: 'isType',
        params: { expectedType: 'string' },
        severity: 'error',
        enabled: true,
      });

      const results = await framework.runAll();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should run assertions for a specific cell', async () => {
      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'noError',
        params: {},
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 0 },
        type: 'isType',
        params: { expectedType: 'boolean' },
        severity: 'error',
        enabled: true,
      });

      const results = await framework.runCell('sheet1', 0, 0);
      expect(results).toHaveLength(2);
    });

    it('should run a single assertion', async () => {
      const assertion = framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      const result = await framework.runAssertion(assertion.id);
      expect(result).toBeDefined();
      expect(result?.passed).toBe(true);
    });

    it('should skip disabled assertions', async () => {
      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 1 },
        type: 'equals',
        params: { expected: 'wrong' },
        severity: 'error',
        enabled: false, // Disabled
      });

      const results = await framework.runAll();
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('should run auto-run suites', async () => {
      const assertion = framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      const suite1 = framework.createSuite('Auto Run Suite', { autoRun: true });
      const suite2 = framework.createSuite('Manual Suite', { autoRun: false });

      framework.addAssertionsToSuite(suite1.id, [assertion.id]);
      framework.addAssertionsToSuite(suite2.id, [assertion.id]);

      const resultsByuite = await framework.runAutoRunSuites();

      expect(resultsByuite.has(suite1.id)).toBe(true);
      expect(resultsByuite.has(suite2.id)).toBe(false);
    });
  });

  describe('auto-run configuration', () => {
    it('should toggle auto-run mode', () => {
      expect(framework.isAutoRunEnabled()).toBe(false);

      framework.setAutoRun(true);
      expect(framework.isAutoRunEnabled()).toBe(true);

      framework.setAutoRun(false);
      expect(framework.isAutoRunEnabled()).toBe(false);
    });
  });

  describe('error cell detection', () => {
    it('should detect error cells with noError assertion', async () => {
      const _assertion = framework.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 1 }, // Has #DIV/0!
        type: 'noError',
        params: {},
        severity: 'error',
        enabled: true,
      });

      const results = await framework.runAll();

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('Div0');
    });
  });

  describe('range assertions', () => {
    it('should evaluate range assertions on all cells', async () => {
      const _assertion = framework.addAssertion({
        target: {
          type: 'range',
          sheetId: 'sheet1',
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 1,
        },
        type: 'notEmpty',
        params: {},
        severity: 'error',
        enabled: true,
      });

      const results = await framework.runAll();

      // 2x2 = 4 cells
      expect(results).toHaveLength(4);
    });
  });

  describe('backward compatibility', () => {
    it('should accept doc parameter without error', () => {
      // Simulate the old API where doc was required
      const framework2 = new TestingFramework({
        doc: { fake: 'doc' }, // Should be ignored
        valueProvider: createMockValueProvider(values),
      });

      const assertion = framework2.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      expect(assertion.id).toBeDefined();
      framework2.clearHandlers();
    });
  });
});
