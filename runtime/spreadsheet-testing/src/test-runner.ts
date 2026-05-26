/**
 * Test Runner - Orchestrates test execution
 *
 * Coordinates between TestStore (persistence) and AssertionEngine (evaluation).
 * Handles test scheduling, result aggregation, and event emission.
 */

import type {
  AssertionFailedEvent,
  CellAssertion,
  TestResult,
  TestRunSummary,
  TestsCompletedEvent,
} from '@mog-sdk/contracts/testing';

import { AssertionEngine, type ICellValueProvider } from './assertion-engine';
import { TestStore } from './test-store';

/**
 * Event emitter interface for test events
 */
export interface ITestEventEmitter {
  emit(event: TestsCompletedEvent | AssertionFailedEvent): void;
}

/**
 * TestRunner options
 */
export interface TestRunnerOptions {
  /** Value provider for accessing cell values */
  valueProvider: ICellValueProvider;

  /** Test store for persistence */
  testStore: TestStore;

  /** Optional event emitter for test events */
  eventEmitter?: ITestEventEmitter;
}

/**
 * TestRunner - orchestrates test execution
 */
export class TestRunner {
  private assertionEngine: AssertionEngine;
  private testStore: TestStore;
  private eventEmitter?: ITestEventEmitter;

  // Event handlers
  private testsCompletedHandlers: Set<(results: TestResult[], summary: TestRunSummary) => void> =
    new Set();
  private assertionFailedHandlers: Set<(result: TestResult) => void> = new Set();

  constructor(options: TestRunnerOptions) {
    this.assertionEngine = new AssertionEngine(options.valueProvider);
    this.testStore = options.testStore;
    this.eventEmitter = options.eventEmitter;
  }

  // ===========================================================================
  // Test Execution
  // ===========================================================================

  /**
   * Run all enabled assertions
   */
  async runAll(): Promise<TestResult[]> {
    const assertions = this.testStore.getAllAssertions();
    const enabledAssertions = assertions.filter((a) => a.enabled);

    return this.runAssertions(enabledAssertions);
  }

  /**
   * Run assertions in a specific suite
   */
  async runSuite(suiteId: string): Promise<TestResult[]> {
    const suite = this.testStore.getSuite(suiteId);
    if (!suite) {
      return [];
    }

    const assertions = suite.assertionIds
      .map((id) => this.testStore.getAssertion(id))
      .filter((a): a is CellAssertion => a !== undefined && a.enabled);

    const results = await this.runAssertions(assertions, suiteId);

    // Calculate summary
    const summary = this.calculateSummary(results);

    // Store results in suite
    this.testStore.storeSuiteResults(suiteId, results, summary);

    return results;
  }

  /**
   * Run assertions for a specific cell
   */
  async runCell(sheetId: string, row: number, col: number): Promise<TestResult[]> {
    const assertions = this.testStore.getAssertionsForCell(sheetId, row, col);
    const enabledAssertions = assertions.filter((a) => a.enabled);

    return this.runAssertions(enabledAssertions);
  }

  /**
   * Run a single assertion
   */
  async runAssertion(assertionId: string): Promise<TestResult | undefined> {
    const assertion = this.testStore.getAssertion(assertionId);
    if (!assertion || !assertion.enabled) {
      return undefined;
    }

    const results = this.assertionEngine.evaluate(assertion);

    // Handle failures
    for (const result of results) {
      if (!result.passed) {
        this.emitAssertionFailed(result);
      }
    }

    return results[0];
  }

  /**
   * Run auto-run suites (called after recalculation)
   */
  async runAutoRunSuites(): Promise<Map<string, TestResult[]>> {
    const suites = this.testStore.listSuites();
    const autoRunSuites = suites.filter((s) => s.autoRun);

    const resultsByuite = new Map<string, TestResult[]>();

    for (const suite of autoRunSuites) {
      const results = await this.runSuite(suite.id);
      resultsByuite.set(suite.id, results);
    }

    return resultsByuite;
  }

  // ===========================================================================
  // Internal Execution
  // ===========================================================================

  /**
   * Run a set of assertions
   */
  private async runAssertions(
    assertions: CellAssertion[],
    suiteId?: string,
  ): Promise<TestResult[]> {
    const startTime = performance.now();
    const allResults: TestResult[] = [];

    for (const assertion of assertions) {
      const results = this.assertionEngine.evaluate(assertion);

      for (const result of results) {
        allResults.push(result);

        // Emit failure events
        if (!result.passed) {
          this.emitAssertionFailed(result);
        }
      }
    }

    // Calculate summary
    const summary = this.calculateSummary(allResults);
    summary.durationMs = performance.now() - startTime;

    // Emit completion event
    this.emitTestsCompleted(allResults, summary, suiteId);

    return allResults;
  }

  /**
   * Calculate summary from results
   */
  private calculateSummary(results: TestResult[]): TestRunSummary {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const errors = results.filter((r) => !r.passed && r.severity === 'error').length;
    const warnings = results.filter((r) => !r.passed && r.severity === 'warning').length;

    return {
      total: results.length,
      passed,
      failed,
      skipped: 0, // Skipped assertions are not included in results
      errors,
      warnings,
      durationMs: results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
    };
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  private emitTestsCompleted(
    results: TestResult[],
    summary: TestRunSummary,
    suiteId?: string,
  ): void {
    const event: TestsCompletedEvent = {
      type: 'tests:completed',
      timestamp: Date.now(),
      suiteId,
      results,
      summary,
    };

    // Emit to external event emitter
    this.eventEmitter?.emit(event);

    // Notify local handlers
    this.testsCompletedHandlers.forEach((handler) => {
      try {
        handler(results, summary);
      } catch (error) {
        console.error('[TestRunner] Error in testsCompleted handler:', error);
      }
    });
  }

  private emitAssertionFailed(result: TestResult): void {
    const event: AssertionFailedEvent = {
      type: 'assertion:failed',
      timestamp: Date.now(),
      result,
    };

    // Emit to external event emitter
    this.eventEmitter?.emit(event);

    // Notify local handlers
    this.assertionFailedHandlers.forEach((handler) => {
      try {
        handler(result);
      } catch (error) {
        console.error('[TestRunner] Error in assertionFailed handler:', error);
      }
    });
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Subscribe to test completion events
   */
  onTestsCompleted(handler: (results: TestResult[], summary: TestRunSummary) => void): () => void {
    this.testsCompletedHandlers.add(handler);
    return () => this.testsCompletedHandlers.delete(handler);
  }

  /**
   * Subscribe to assertion failure events
   */
  onAssertionFailed(handler: (result: TestResult) => void): () => void {
    this.assertionFailedHandlers.add(handler);
    return () => this.assertionFailedHandlers.delete(handler);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all event handlers
   */
  clearHandlers(): void {
    this.testsCompletedHandlers.clear();
    this.assertionFailedHandlers.clear();
  }
}

/**
 * Create a test runner
 */
export function createTestRunner(options: TestRunnerOptions): TestRunner {
  return new TestRunner(options);
}
