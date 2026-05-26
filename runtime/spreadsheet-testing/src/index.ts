/**
 * @mog/spreadsheet-testing
 *
 * Testing framework for spreadsheets - enables "unit tests for spreadsheets".
 * Users can define assertions on cells, run test suites, and catch errors
 * before they reach stakeholders.
 *
 */

// Re-export types from contracts
export type {
  AssertionChangedEvent,
  AssertionFailedEvent,
  AssertionParams,
  AssertionSeverity,
  AssertionTarget,
  AssertionType,
  CellAssertion,
  ITestingFramework,
  TestResult,
  TestRunSummary,
  TestSuite,
  TestingEvent,
  TestsCompletedEvent,
} from '@mog-sdk/contracts/testing';

// Assertion Engine
export { AssertionEngine, createAssertionEngine } from './assertion-engine';
export type { ICellValueProvider } from './assertion-engine';

// Test Store
export { TestStore, createTestStore } from './test-store';

// Test Runner
export { TestRunner, createTestRunner } from './test-runner';
export type { ITestEventEmitter, TestRunnerOptions } from './test-runner';

// Testing Framework (main entry point)
export { TestingFramework, createTestingFramework } from './testing-framework';
export type { TestingFrameworkOptions } from './testing-framework';
