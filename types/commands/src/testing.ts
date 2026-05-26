/**
 * Testing Framework Contracts
 *
 * Type definitions for the spreadsheet testing framework.
 * Enables "unit tests for spreadsheets" - users define assertions on cells,
 * run test suites, and catch errors before they reach stakeholders.
 *
 */

// ============================================================================
// Assertion Types
// ============================================================================

/**
 * Types of assertions that can be made about cell values
 */
export type AssertionType =
  | 'equals' // Value equals expected
  | 'notEquals' // Value does not equal expected
  | 'greaterThan' // Value > expected (numeric)
  | 'lessThan' // Value < expected (numeric)
  | 'greaterOrEqual' // Value >= expected (numeric)
  | 'lessOrEqual' // Value <= expected (numeric)
  | 'between' // Value is between min and max (inclusive)
  | 'notEmpty' // Cell is not empty/null/undefined
  | 'isEmpty' // Cell is empty/null/undefined
  | 'isType' // Value matches expected type (string, number, boolean, date)
  | 'isUnique' // Value is unique in a range (for column assertions)
  | 'matchesPattern' // Value matches regex pattern (string)
  | 'noError' // Cell does not contain an error value
  | 'formula'; // Custom formula returns truthy value

/**
 * Severity level of an assertion failure
 */
export type AssertionSeverity = 'error' | 'warning' | 'info';

/**
 * Target for an assertion - either a single cell or a range
 */
export type AssertionTarget =
  | {
      type: 'cell';
      sheetId: string;
      row: number;
      col: number;
    }
  | {
      type: 'range';
      sheetId: string;
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    };

/**
 * Parameters for different assertion types
 */
export interface AssertionParams {
  // For equals/notEquals
  expected?: unknown;

  // For greaterThan/lessThan/greaterOrEqual/lessOrEqual
  threshold?: number;

  // For between
  min?: number;
  max?: number;

  // For isType
  expectedType?: 'string' | 'number' | 'boolean' | 'date' | 'error';

  // For matchesPattern
  pattern?: string;

  // For formula assertions
  formula?: string;

  // For isUnique - scope of uniqueness check
  uniqueScope?: 'column' | 'row' | 'range';
}

/**
 * A single cell assertion definition
 */
export interface CellAssertion {
  /** Unique identifier for this assertion */
  id: string;

  /** Human-readable name for the assertion */
  name?: string;

  /** Target cell or range */
  target: AssertionTarget;

  /** Type of assertion to perform */
  type: AssertionType;

  /** Parameters specific to the assertion type */
  params: AssertionParams;

  /** Custom error message to display on failure */
  message?: string;

  /** Severity level of failure */
  severity: AssertionSeverity;

  /** Whether this assertion is enabled */
  enabled: boolean;

  /** Timestamp when assertion was created */
  createdAt?: number;

  /** Timestamp when assertion was last modified */
  updatedAt?: number;
}

// ============================================================================
// Test Result Types
// ============================================================================

/**
 * Result of evaluating a single assertion
 */
export interface TestResult {
  /** ID of the assertion that was evaluated */
  assertionId: string;

  /** Name of the assertion (if provided) */
  assertionName?: string;

  /** Address where the assertion was evaluated */
  address: {
    sheetId: string;
    row: number;
    col: number;
  };

  /** Whether the assertion passed */
  passed: boolean;

  /** Actual value found in the cell */
  actual?: unknown;

  /** Expected value (if applicable) */
  expected?: unknown;

  /** Error message if failed */
  message?: string;

  /** Severity of the failure (if failed) */
  severity: AssertionSeverity;

  /** Timestamp when test was run */
  timestamp: number;

  /** How long the evaluation took (ms) */
  durationMs?: number;
}

/**
 * Summary of a test run
 */
export interface TestRunSummary {
  /** Total number of assertions evaluated */
  total: number;

  /** Number of passed assertions */
  passed: number;

  /** Number of failed assertions */
  failed: number;

  /** Number of skipped assertions (disabled) */
  skipped: number;

  /** Number of errors (failures by severity) */
  errors: number;

  /** Number of warnings (failures by severity) */
  warnings: number;

  /** Total duration of test run (ms) */
  durationMs: number;
}

// ============================================================================
// Test Suite Types
// ============================================================================

/**
 * A named collection of assertions
 */
export interface TestSuite {
  /** Unique identifier for this suite */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this suite tests */
  description?: string;

  /** IDs of assertions in this suite */
  assertionIds: string[];

  /** Whether to automatically run tests after recalculation */
  autoRun: boolean;

  /** Whether to block export if this suite fails */
  blockOnFailure: boolean;

  /** Timestamp of last test run */
  lastRun?: number;

  /** Results from last test run */
  lastResults?: TestResult[];

  /** Summary from last test run */
  lastSummary?: TestRunSummary;

  /** Timestamp when suite was created */
  createdAt?: number;

  /** Timestamp when suite was last modified */
  updatedAt?: number;
}

// ============================================================================
// Testing Framework Interface
// ============================================================================

/**
 * Main interface for the testing framework
 */
export interface ITestingFramework {
  // ===========================================================================
  // Assertions CRUD
  // ===========================================================================

  /**
   * Add a new assertion
   * @param assertion Assertion definition without ID
   * @returns Created assertion with generated ID
   */
  addAssertion(assertion: Omit<CellAssertion, 'id'>): CellAssertion;

  /**
   * Update an existing assertion
   * @param id Assertion ID to update
   * @param updates Partial assertion updates
   */
  updateAssertion(id: string, updates: Partial<CellAssertion>): void;

  /**
   * Remove an assertion
   * @param id Assertion ID to remove
   */
  removeAssertion(id: string): void;

  /**
   * Get an assertion by ID
   * @param id Assertion ID
   * @returns Assertion or undefined if not found
   */
  getAssertion(id: string): CellAssertion | undefined;

  /**
   * Get all assertions targeting a specific cell
   * @param sheetId Sheet ID
   * @param row Row index
   * @param col Column index
   * @returns Array of assertions targeting this cell
   */
  getAssertionsForCell(sheetId: string, row: number, col: number): CellAssertion[];

  /**
   * Get all assertions
   * @returns Array of all assertions
   */
  getAllAssertions(): CellAssertion[];

  // ===========================================================================
  // Test Suites CRUD
  // ===========================================================================

  /**
   * Create a new test suite
   * @param name Suite name
   * @param options Optional suite configuration
   * @returns Created suite
   */
  createSuite(name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>): TestSuite;

  /**
   * Update an existing suite
   * @param id Suite ID
   * @param updates Partial suite updates
   */
  updateSuite(id: string, updates: Partial<TestSuite>): void;

  /**
   * Delete a suite
   * @param id Suite ID to delete
   */
  deleteSuite(id: string): void;

  /**
   * Get a suite by ID
   * @param id Suite ID
   * @returns Suite or undefined if not found
   */
  getSuite(id: string): TestSuite | undefined;

  /**
   * Get all suites
   * @returns Array of all suites
   */
  listSuites(): TestSuite[];

  /**
   * Add assertions to a suite
   * @param suiteId Suite ID
   * @param assertionIds Assertion IDs to add
   */
  addAssertionsToSuite(suiteId: string, assertionIds: string[]): void;

  /**
   * Remove assertions from a suite
   * @param suiteId Suite ID
   * @param assertionIds Assertion IDs to remove
   */
  removeAssertionsFromSuite(suiteId: string, assertionIds: string[]): void;

  // ===========================================================================
  // Test Execution
  // ===========================================================================

  /**
   * Run all enabled assertions
   * @returns Array of test results
   */
  runAll(): Promise<TestResult[]>;

  /**
   * Run a specific test suite
   * @param suiteId Suite ID to run
   * @returns Array of test results
   */
  runSuite(suiteId: string): Promise<TestResult[]>;

  /**
   * Run assertions for a specific cell
   * @param sheetId Sheet ID
   * @param row Row index
   * @param col Column index
   * @returns Array of test results
   */
  runCell(sheetId: string, row: number, col: number): Promise<TestResult[]>;

  /**
   * Run a single assertion
   * @param assertionId Assertion ID to run
   * @returns Test result
   */
  runAssertion(assertionId: string): Promise<TestResult | undefined>;

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Enable or disable auto-run mode
   * When enabled, tests run automatically after recalculation
   * @param enabled Whether auto-run is enabled
   */
  setAutoRun(enabled: boolean): void;

  /**
   * Check if auto-run is enabled
   * @returns Whether auto-run is enabled
   */
  isAutoRunEnabled(): boolean;

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Subscribe to test completion events
   * @param handler Called when tests complete
   * @returns Unsubscribe function
   */
  onTestsCompleted(handler: (results: TestResult[], summary: TestRunSummary) => void): () => void;

  /**
   * Subscribe to assertion failure events
   * @param handler Called when an assertion fails
   * @returns Unsubscribe function
   */
  onAssertionFailed(handler: (result: TestResult) => void): () => void;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitted when tests complete
 */
export interface TestsCompletedEvent {
  type: 'tests:completed';
  timestamp: number;
  suiteId?: string;
  results: TestResult[];
  summary: TestRunSummary;
}

/**
 * Event emitted when an assertion fails
 */
export interface AssertionFailedEvent {
  type: 'assertion:failed';
  timestamp: number;
  result: TestResult;
}

/**
 * Event emitted when an assertion is created/updated/deleted
 */
export interface AssertionChangedEvent {
  type: 'assertion:changed';
  timestamp: number;
  action: 'add' | 'update' | 'delete';
  assertionId: string;
  assertion?: CellAssertion;
}

/**
 * All testing-related events
 */
export type TestingEvent = TestsCompletedEvent | AssertionFailedEvent | AssertionChangedEvent;
