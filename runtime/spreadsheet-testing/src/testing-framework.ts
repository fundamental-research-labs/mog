/**
 * Testing Framework - Main Entry Point
 *
 * Implements ITestingFramework interface and provides the public API
 * for the spreadsheet testing system.
 *
 * Removed Yjs dependency. TestStore now uses plain Maps.
 */

import type {
  CellAssertion,
  ITestingFramework,
  TestResult,
  TestRunSummary,
  TestSuite,
} from '@mog-sdk/contracts/testing';

import type { ICellValueProvider } from './assertion-engine';
import { TestRunner, type ITestEventEmitter } from './test-runner';
import { TestStore } from './test-store';

/**
 * Options for creating a TestingFramework instance
 */
export interface TestingFrameworkOptions {
  /**
   * @deprecated Yjs doc is no longer used. This field is accepted but ignored
   * for backward compatibility with existing callers (e.g., use-testing.ts).
   */
  doc?: unknown;

  /** Value provider for accessing cell values */
  valueProvider: ICellValueProvider;

  /** Optional event emitter for integrating with the spreadsheet event bus */
  eventEmitter?: ITestEventEmitter;
}

/**
 * TestingFramework - main class implementing ITestingFramework
 */
export class TestingFramework implements ITestingFramework {
  private testStore: TestStore;
  private testRunner: TestRunner;

  constructor(options: TestingFrameworkOptions) {
    this.testStore = new TestStore();
    this.testRunner = new TestRunner({
      valueProvider: options.valueProvider,
      testStore: this.testStore,
      eventEmitter: options.eventEmitter,
    });
  }

  // ===========================================================================
  // Assertions CRUD
  // ===========================================================================

  addAssertion(assertion: Omit<CellAssertion, 'id'>): CellAssertion {
    return this.testStore.addAssertion(assertion);
  }

  updateAssertion(id: string, updates: Partial<CellAssertion>): void {
    this.testStore.updateAssertion(id, updates);
  }

  removeAssertion(id: string): void {
    this.testStore.removeAssertion(id);
  }

  getAssertion(id: string): CellAssertion | undefined {
    return this.testStore.getAssertion(id);
  }

  getAssertionsForCell(sheetId: string, row: number, col: number): CellAssertion[] {
    return this.testStore.getAssertionsForCell(sheetId, row, col);
  }

  getAllAssertions(): CellAssertion[] {
    return this.testStore.getAllAssertions();
  }

  // ===========================================================================
  // Test Suites CRUD
  // ===========================================================================

  createSuite(name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>): TestSuite {
    return this.testStore.createSuite(name, options);
  }

  updateSuite(id: string, updates: Partial<TestSuite>): void {
    this.testStore.updateSuite(id, updates);
  }

  deleteSuite(id: string): void {
    this.testStore.deleteSuite(id);
  }

  getSuite(id: string): TestSuite | undefined {
    return this.testStore.getSuite(id);
  }

  listSuites(): TestSuite[] {
    return this.testStore.listSuites();
  }

  addAssertionsToSuite(suiteId: string, assertionIds: string[]): void {
    this.testStore.addAssertionsToSuite(suiteId, assertionIds);
  }

  removeAssertionsFromSuite(suiteId: string, assertionIds: string[]): void {
    this.testStore.removeAssertionsFromSuite(suiteId, assertionIds);
  }

  // ===========================================================================
  // Test Execution
  // ===========================================================================

  async runAll(): Promise<TestResult[]> {
    return this.testRunner.runAll();
  }

  async runSuite(suiteId: string): Promise<TestResult[]> {
    return this.testRunner.runSuite(suiteId);
  }

  async runCell(sheetId: string, row: number, col: number): Promise<TestResult[]> {
    return this.testRunner.runCell(sheetId, row, col);
  }

  async runAssertion(assertionId: string): Promise<TestResult | undefined> {
    return this.testRunner.runAssertion(assertionId);
  }

  /**
   * Run all auto-run suites (typically called after recalculation)
   */
  async runAutoRunSuites(): Promise<Map<string, TestResult[]>> {
    return this.testRunner.runAutoRunSuites();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setAutoRun(enabled: boolean): void {
    this.testStore.setAutoRunEnabled(enabled);
  }

  isAutoRunEnabled(): boolean {
    return this.testStore.isAutoRunEnabled();
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  onTestsCompleted(handler: (results: TestResult[], summary: TestRunSummary) => void): () => void {
    return this.testRunner.onTestsCompleted(handler);
  }

  onAssertionFailed(handler: (result: TestResult) => void): () => void {
    return this.testRunner.onAssertionFailed(handler);
  }

  // ===========================================================================
  // Store Observers
  // ===========================================================================

  /**
   * Subscribe to assertion changes
   */
  onAssertionsChanged(callback: () => void): () => void {
    return this.testStore.onAssertionsChanged(callback);
  }

  /**
   * Subscribe to suite changes
   */
  onSuitesChanged(callback: () => void): () => void {
    return this.testStore.onSuitesChanged(callback);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all event handlers
   */
  clearHandlers(): void {
    this.testRunner.clearHandlers();
  }
}

/**
 * Create a testing framework instance
 */
export function createTestingFramework(options: TestingFrameworkOptions): TestingFramework {
  return new TestingFramework(options);
}
